import { createHash } from "node:crypto";
import { AUSD, X402_NETWORK } from "@a-eye/shared";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import {
  HTTPFacilitatorClient,
  PAYMENT_REQUIRED_CACHE_CONTROL,
  x402ResourceServer,
  type FacilitatorClient,
} from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";

export const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";

type Hex = `0x${string}`;

export interface PaymentContext {
  payer: Hex;
  /** Settlement tx hash. `null` only when `settle: "after"` (the handler runs before settlement). */
  txHash: Hex | null;
  amountUnits: bigint;
  network: typeof X402_NETWORK;
  requirements: PaymentRequirements;
}

export type PaidHandler = (req: Request, ctx: PaymentContext) => Promise<Response>;

export interface X402Options<Body = unknown> {
  /** Price in AUSD base units. Throw to reject the request with 400 before any payment is asked for. */
  price: (req: Request, body: Body) => Promise<{ amountUnits: bigint }> | { amountUnits: bigint };
  /** Recipient address. Defaults to `A_EYE_TREASURY_ADDRESS`. */
  payTo?: string;
  description?: string;
  /**
   * "before" (default): settle on-chain, then run the handler with the tx hash.
   * "after": run the handler first and settle only when it returns 2xx/3xx.
   */
  settle?: "before" | "after";
  /** Called when the handler throws or returns >= 400 after the payment was settled (e.g. to refund). */
  onHandlerFailure?: (ctx: PaymentContext, failure: { response?: Response; error?: unknown }) => Promise<void> | void;
  facilitator?: FacilitatorClient;
  maxTimeoutSeconds?: number;
}

export class X402InputError extends Error {}

const servers = new WeakMap<FacilitatorClient, Promise<x402ResourceServer>>();
const usedAuthorizations = new Map<string, number>();
let defaultFacilitator: FacilitatorClient | undefined;

export function facilitatorFromEnv(): FacilitatorClient {
  defaultFacilitator ??= new HTTPFacilitatorClient({ url: process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL });
  return defaultFacilitator;
}

function resourceServer(facilitator: FacilitatorClient): Promise<x402ResourceServer> {
  let server = servers.get(facilitator);
  if (!server) {
    const s = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactEvmScheme());
    server = s.initialize().then(() => s);
    server.catch(() => servers.delete(facilitator));
    servers.set(facilitator, server);
  }
  return server;
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function rebuild(req: Request, text: string): Request {
  return new Request(req.url, { method: req.method, headers: req.headers, body: text || undefined });
}

/** Wrap a `(req: Request) => Promise<Response>` route handler so it charges a dynamic AUSD price via x402 (exact, Base Sepolia). */
export function withX402Payment<Body = unknown>(handler: PaidHandler, options: X402Options<Body>) {
  return async function paidRoute(req: Request): Promise<Response> {
    const text = await req.text();
    let body: Body;
    let amountUnits: bigint;
    try {
      body = (text ? JSON.parse(text) : undefined) as Body;
      ({ amountUnits } = await options.price(rebuild(req, text), body));
    } catch (err) {
      return json({ error: "invalid", message: err instanceof Error ? err.message : String(err) }, 400);
    }
    if (amountUnits <= BigInt(0)) return json({ error: "invalid", message: "Price must be positive" }, 400);

    const payTo = options.payTo ?? process.env.A_EYE_TREASURY_ADDRESS;
    if (!payTo) return json({ error: "payments_unconfigured", message: "A_EYE_TREASURY_ADDRESS is not set" }, 500);

    const facilitator = options.facilitator ?? facilitatorFromEnv();
    let server: x402ResourceServer;
    try {
      server = await resourceServer(facilitator);
    } catch (err) {
      console.error("[x402] facilitator unavailable:", err);
      return json({ error: "facilitator_unavailable", message: "Payment facilitator unavailable" }, 502);
    }

    const maxTimeoutSeconds = options.maxTimeoutSeconds ?? 300;
    const [requirements] = await server.buildPaymentRequirements({
      scheme: "exact",
      network: X402_NETWORK,
      payTo,
      price: { asset: AUSD.address, amount: amountUnits.toString(), extra: { ...AUSD.eip712 } },
      maxTimeoutSeconds,
    });
    if (!requirements) return json({ error: "payments_unconfigured", message: "No payment requirements" }, 500);

    const challenge = async (error: string, status = 402) => {
      const paymentRequired = await server.createPaymentRequiredResponse(
        [requirements],
        { url: req.url, description: options.description, mimeType: "application/json" },
        error,
      );
      return json({ error, ...paymentRequired }, status, {
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired),
        "Cache-Control": PAYMENT_REQUIRED_CACHE_CONTROL,
      });
    };

    const header = req.headers.get("payment-signature") ?? req.headers.get("x-payment");
    if (!header) return challenge("Payment required");

    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(header);
    } catch {
      return challenge("Invalid PAYMENT-SIGNATURE header");
    }
    const matched = server.findMatchingRequirements([requirements], payload);
    if (!matched) return challenge("Payment does not match the requirements");

    const authorization = payload.payload?.authorization as { from?: string; nonce?: string } | undefined;
    const payer = authorization?.from ?? "";
    const nonce = authorization?.nonce ?? createHash("sha256").update(header).digest("hex");
    const replayKey = `${payer}:${nonce}`;
    const now = Date.now();
    for (const [key, expiresAt] of usedAuthorizations) {
      if (expiresAt <= now) usedAuthorizations.delete(key);
    }
    if ((usedAuthorizations.get(replayKey) ?? 0) > now) {
      return challenge("Payment authorization already used");
    }
    usedAuthorizations.set(replayKey, now + 2 * maxTimeoutSeconds * 1000);

    const verify = await server.verifyPayment(payload, matched).catch((err: unknown) => ({
      isValid: false,
      invalidReason: err instanceof Error ? err.message : String(err),
      payer: undefined,
    }));
    if (!verify.isValid) {
      usedAuthorizations.delete(replayKey);
      return challenge(verify.invalidReason ?? "Payment verification failed");
    }

    const ctx: PaymentContext = {
      payer: (verify.payer ?? "0x") as Hex,
      txHash: null,
      amountUnits,
      network: X402_NETWORK,
      requirements: matched,
    };

    const settle = async (): Promise<SettleResponse | Response> => {
      const res = await server.settlePayment(payload, matched).catch(
        (err: unknown): SettleResponse => ({
          success: false,
          errorReason: err instanceof Error ? err.message : String(err),
          transaction: "",
          network: X402_NETWORK,
        }),
      );
      if (!res.success) {
        usedAuthorizations.delete(replayKey);
        return challenge(res.errorReason ?? "Payment settlement failed");
      }
      ctx.txHash = res.transaction as Hex;
      if (res.payer) ctx.payer = res.payer as Hex;
      return res;
    };

    const withReceipt = (response: Response, receipt: SettleResponse) => {
      const headers = new Headers(response.headers);
      headers.set("PAYMENT-RESPONSE", encodePaymentResponseHeader(receipt));
      headers.append("Access-Control-Expose-Headers", "PAYMENT-RESPONSE");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };

    if ((options.settle ?? "before") === "before") {
      const receipt = await settle();
      if (receipt instanceof Response) return receipt;
      let response: Response;
      try {
        response = await handler(rebuild(req, text), ctx);
      } catch (error) {
        await options.onHandlerFailure?.(ctx, { error });
        return withReceipt(json({ error: "handler_failed", message: "Paid but the request failed", payment_tx: ctx.txHash }, 500), receipt);
      }
      if (response.status >= 400) await options.onHandlerFailure?.(ctx, { response: response.clone() });
      return withReceipt(response, receipt);
    }

    let response: Response;
    try {
      response = await handler(rebuild(req, text), { ...ctx });
    } catch (error) {
      usedAuthorizations.delete(replayKey);
      throw error;
    }
    if (response.status >= 400) {
      usedAuthorizations.delete(replayKey);
      return response;
    }
    const receipt = await settle();
    if (receipt instanceof Response) return receipt;
    return withReceipt(response, receipt);
  };
}
