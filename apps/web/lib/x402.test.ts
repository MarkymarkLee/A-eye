import { AUSD, X402_NETWORK } from "@a-eye/shared";
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withX402Payment, type PaymentContext } from "./x402";

const TREASURY = "0x293214291186180810902D97994c2C72fE88255A";
const TX = `0x${"ab".repeat(32)}` as const;
const agent = privateKeyToAccount(generatePrivateKey());

function mockFacilitator(overrides: Partial<FacilitatorClient> = {}) {
  const calls = { verify: [] as PaymentRequirements[], settle: [] as PaymentRequirements[] };
  const facilitator: FacilitatorClient = {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: X402_NETWORK }],
      extensions: [],
      signers: {},
    }),
    verify: async (payload: PaymentPayload, req: PaymentRequirements) => {
      calls.verify.push(req);
      return { isValid: true, payer: (payload.payload as { authorization: { from: string } }).authorization.from };
    },
    settle: async (payload: PaymentPayload, req: PaymentRequirements) => {
      calls.settle.push(req);
      return { success: true, transaction: TX, network: X402_NETWORK, payer: agent.address };
    },
    ...overrides,
  } as FacilitatorClient;
  return { facilitator, calls };
}

const payingClient = () =>
  new x402Client()
    .register(X402_NETWORK, new ExactEvmScheme(agent))
    .setSpendControls({ allowedAssets: [{ network: X402_NETWORK, asset: AUSD.address }] });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://a-eye.test/api/questions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const price = (_req: Request, body: { prize_usd?: number }) => {
  if (typeof body?.prize_usd !== "number") throw new Error("prize_usd is required");
  return { amountUnits: BigInt(Math.round(body.prize_usd * 1e6)) };
};

describe("withX402Payment", () => {
  let seen: { body: unknown; ctx: PaymentContext }[];
  const handler = async (req: Request, ctx: PaymentContext) => {
    seen.push({ body: await req.json(), ctx });
    return Response.json({ question_id: "q1", payment_tx: ctx.txHash }, { status: 201 });
  };
  beforeEach(() => {
    seen = [];
  });

  it("returns a 402 challenge priced at the prize in AUSD base units with the Agora Dollar domain", async () => {
    const { facilitator } = mockFacilitator();
    const route = withX402Payment(handler, { price, payTo: TREASURY, facilitator, description: "Ask" });
    const res = await route(post({ prize_usd: 0.01 }));
    expect(res.status).toBe(402);
    const required = decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!);
    expect(required.accepts).toEqual([
      expect.objectContaining({
        scheme: "exact",
        network: "eip155:84532",
        asset: AUSD.address,
        amount: "10000",
        payTo: TREASURY,
        extra: { name: "Agora Dollar", version: "1" },
      }),
    ]);
    expect(seen).toHaveLength(0);
  });

  it("rejects an unpriceable body with 400 before asking for payment", async () => {
    const { facilitator } = mockFacilitator();
    const route = withX402Payment(handler, { price, payTo: TREASURY, facilitator });
    const res = await route(post({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid", message: "prize_usd is required" });
  });

  it("pays through @x402/fetch: verify, settle, then the handler gets payer + tx hash", async () => {
    const { facilitator, calls } = mockFacilitator();
    const route = withX402Payment(handler, { price, payTo: TREASURY, facilitator });
    const fetchImpl = wrapFetchWithPayment((input, init) => route(new Request(input, init)), payingClient());
    const res = await fetchImpl("http://a-eye.test/api/questions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prize_usd: 1.5, question: "Line?" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ question_id: "q1", payment_tx: TX });
    expect(decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE")!)).toMatchObject({ success: true, transaction: TX });
    expect(calls.verify).toHaveLength(1);
    expect(calls.settle[0]).toMatchObject({ amount: "1500000" });
    expect(seen).toEqual([
      { body: { prize_usd: 1.5, question: "Line?" }, ctx: expect.objectContaining({ payer: agent.address, txHash: TX, amountUnits: BigInt(1_500_000) }) },
    ]);
  });

  it("signs ERC-3009 against the Agora Dollar EIP-712 domain", async () => {
    let payload: PaymentPayload | undefined;
    const { facilitator } = mockFacilitator({
      verify: async (p) => {
        payload = p;
        return { isValid: true, payer: agent.address };
      },
    });
    const route = withX402Payment(handler, { price, payTo: TREASURY, facilitator });
    await wrapFetchWithPayment((i, init) => route(new Request(i, init)), payingClient())("http://a-eye.test/api/questions", {
      method: "POST",
      body: JSON.stringify({ prize_usd: 0.01 }),
    });
    const { authorization, signature } = payload!.payload as {
      authorization: { from: `0x${string}`; to: `0x${string}`; value: string; validAfter: string; validBefore: string; nonce: `0x${string}` };
      signature: `0x${string}`;
    };
    const signer = await recoverTypedDataAddress({
      domain: { name: "Agora Dollar", version: "1", chainId: 84532, verifyingContract: AUSD.address },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        ...authorization,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
      },
      signature,
    });
    expect(signer).toBe(agent.address);
    expect(authorization).toMatchObject({ to: TREASURY, value: "10000" });
  });

  it("re-challenges when the facilitator rejects the payment", async () => {
    const { facilitator, calls } = mockFacilitator({
      verify: async () => ({ isValid: false, invalidReason: "insufficient_funds" }),
    });
    const route = withX402Payment(handler, { price, payTo: TREASURY, facilitator });
    const res = await route(post({ prize_usd: 0.01 }, { "PAYMENT-SIGNATURE": await signedHeader(0.01) }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "insufficient_funds" });
    expect(calls.settle).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it("does not run the handler when settlement fails", async () => {
    const { facilitator } = mockFacilitator({
      settle: async () => ({ success: false, errorReason: "transaction_failed", transaction: "", network: X402_NETWORK }),
    });
    const route = withX402Payment(handler, { price, payTo: TREASURY, facilitator });
    const res = await route(post({ prize_usd: 0.01 }, { "PAYMENT-SIGNATURE": await signedHeader(0.01) }));
    expect(res.status).toBe(402);
    expect(seen).toHaveLength(0);
  });

  it("rejects a payment signed for a different amount", async () => {
    const { facilitator, calls } = mockFacilitator();
    const route = withX402Payment(handler, { price, payTo: TREASURY, facilitator });
    const res = await route(post({ prize_usd: 5 }, { "PAYMENT-SIGNATURE": await signedHeader(0.01) }));
    expect(res.status).toBe(402);
    expect(calls.verify).toHaveLength(0);
  });

  it("calls onHandlerFailure after a settled payment whose handler fails", async () => {
    const { facilitator } = mockFacilitator();
    const onHandlerFailure = vi.fn();
    const route = withX402Payment(
      async () => {
        throw new Error("db down");
      },
      { price, payTo: TREASURY, facilitator, onHandlerFailure },
    );
    const res = await route(post({ prize_usd: 0.01 }, { "PAYMENT-SIGNATURE": await signedHeader(0.01) }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ payment_tx: TX });
    expect(onHandlerFailure).toHaveBeenCalledWith(expect.objectContaining({ txHash: TX }), { error: expect.any(Error) });
  });

  it('settle: "after" only settles when the handler succeeds', async () => {
    const { facilitator, calls } = mockFacilitator();
    const failing = withX402Payment(async () => Response.json({ error: "closed" }, { status: 409 }), {
      price,
      payTo: TREASURY,
      facilitator,
      settle: "after",
    });
    expect((await failing(post({ prize_usd: 0.01 }, { "PAYMENT-SIGNATURE": await signedHeader(0.01) }))).status).toBe(409);
    expect(calls.settle).toHaveLength(0);

    const ok = withX402Payment(handler, { price, payTo: TREASURY, facilitator, settle: "after" });
    const res = await ok(post({ prize_usd: 0.01 }, { "PAYMENT-SIGNATURE": await signedHeader(0.01) }));
    expect(res.status).toBe(201);
    expect(calls.settle).toHaveLength(1);
    expect(seen[0]!.ctx.txHash).toBeNull();
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
  });
});

async function signedHeader(prizeUsd: number): Promise<string> {
  const { facilitator } = mockFacilitator();
  const route = withX402Payment(async () => new Response(null, { status: 204 }), { price, payTo: TREASURY, facilitator });
  const challenge = await route(post({ prize_usd: prizeUsd }));
  const required = decodePaymentRequiredHeader(challenge.headers.get("PAYMENT-REQUIRED")!);
  return encodePaymentSignatureHeader(await payingClient().createPaymentPayload(required));
}
