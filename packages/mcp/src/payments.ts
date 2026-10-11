import { AUSD, X402_NETWORK } from "@a-eye/shared";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import type { FetchLike } from "./api.js";

export const DEFAULT_MAX_PAYMENT_UNITS = 25_000_000n;

export function agentPrivateKey(env: NodeJS.ProcessEnv = process.env): `0x${string}` | undefined {
  const key = env.AGENT_PRIVATE_KEY || env.A_EYE_AGENT_PRIVATE_KEY;
  if (!key) return undefined;
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

/** Wrap fetch so 402 challenges for AUSD on Base Sepolia are paid automatically with the agent wallet. */
export function createPayingFetch(
  privateKey: `0x${string}`,
  { maxPaymentUnits = DEFAULT_MAX_PAYMENT_UNITS, baseFetch = fetch as FetchLike } = {},
): { fetch: FetchLike; address: `0x${string}` } {
  const account = privateKeyToAccount(privateKey);
  const client = new x402Client().register(X402_NETWORK, new ExactEvmScheme(account)).setSpendControls({
    allowedAssets: [{ network: X402_NETWORK, asset: AUSD.address, maxAmountPerPayment: maxPaymentUnits.toString() }],
  });
  const paying = wrapFetchWithPayment(async (input, init) => {
    const req = new Request(input, init);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    return baseFetch(req.url, { method: req.method, headers: req.headers, body });
  }, client);
  return { fetch: (input, init) => paying(input, init), address: account.address };
}

export function paymentFromEnv(env: NodeJS.ProcessEnv = process.env, baseFetch: FetchLike = fetch) {
  const key = agentPrivateKey(env);
  if (!key) return undefined;
  const maxUsd = Number(env.A_EYE_MAX_PAYMENT_USD);
  const maxPaymentUnits = Number.isFinite(maxUsd) && maxUsd > 0 ? BigInt(Math.round(maxUsd * 10 ** AUSD.decimals)) : undefined;
  return createPayingFetch(key, { maxPaymentUnits, baseFetch });
}

/** Settlement tx hash from the x402 `PAYMENT-RESPONSE` header, if the request was paid. */
export function paymentTxFromHeaders(headers: Headers): string | null {
  const header = headers.get("PAYMENT-RESPONSE") ?? headers.get("X-PAYMENT-RESPONSE");
  if (!header) return null;
  try {
    const receipt = decodePaymentResponseHeader(header);
    return receipt.success && receipt.transaction ? receipt.transaction : null;
  } catch {
    return null;
  }
}
