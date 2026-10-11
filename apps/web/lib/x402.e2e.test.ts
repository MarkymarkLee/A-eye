import { AUSD } from "@a-eye/shared";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import { withX402Payment } from "./x402";

// Live Base Sepolia proof: the agent wallet pays the treasury 0.01 AUSD through the public facilitator.
// Run: X402_E2E=1 A_EYE_AGENT_PRIVATE_KEY=0x... A_EYE_TREASURY_ADDRESS=0x... npm test -w apps/web -- x402.e2e
const agentKey = process.env.AGENT_PRIVATE_KEY || process.env.A_EYE_AGENT_PRIVATE_KEY;
const payTo = process.env.A_EYE_TREASURY_ADDRESS;
const enabled = process.env.X402_E2E === "1" && Boolean(agentKey && payTo);

describe.skipIf(!enabled)("x402 live e2e (Base Sepolia)", () => {
  it(
    "settles a real 0.01 AUSD payment and exposes the tx hash to the handler",
    async () => {
      const route = withX402Payment(
        async (_req, ctx) => Response.json({ ok: true, payer: ctx.payer, tx: ctx.txHash }, { status: 201 }),
        { price: () => ({ amountUnits: BigInt(10_000) }), payTo, description: "A-eye e2e" },
      );
      const account = privateKeyToAccount(agentKey as `0x${string}`);
      const client = new x402Client().register("eip155:84532", new ExactEvmScheme(account));
      const pay = wrapFetchWithPayment((input, init) => route(new Request(input, init)), client);

      const res = await pay("http://local.test/api/questions", { method: "POST", body: JSON.stringify({ prize_usd: 0.01 }) });
      const body = (await res.json()) as { payer: string; tx: string };
      expect(res.status).toBe(201);
      const receipt = decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE")!);
      console.log(`x402 e2e settled: https://sepolia.basescan.org/tx/${receipt.transaction}`);
      expect(body.payer.toLowerCase()).toBe(account.address.toLowerCase());
      expect(body.tx).toBe(receipt.transaction);

      const chain = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });
      const txReceipt = await chain.waitForTransactionReceipt({ hash: receipt.transaction as `0x${string}` });
      expect(txReceipt.status).toBe("success");
      expect(txReceipt.logs.some((l) => l.address.toLowerCase() === AUSD.address.toLowerCase())).toBe(true);
    },
    120_000,
  );
});
