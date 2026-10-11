import { AUSD, CreateQuestionInput, X402_NETWORK } from "@a-eye/shared";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { AEyeApi, PaymentRequiredError, type FetchLike } from "../src/api";
import {
  agentPrivateKey,
  createPayingFetch,
  paymentFromEnv,
  paymentResponseFromHeaders,
  paymentTxFromHeaders,
} from "../src/payments";

const BASE = "http://a-eye.test";
const TX = `0x${"cd".repeat(32)}`;
const TREASURY = "0x293214291186180810902D97994c2C72fE88255A";
const input = CreateQuestionInput.parse({ lat: 37.8716, lng: -122.2536, question: "Is there a line?", options: ["Yes", "No"] });
const created = {
  question_id: "q1",
  payment_tx: null,
  gallery_url: `${BASE}/q/q1`,
  seed_commit: "abc",
};

function paywalledServer(amount: string) {
  const seen: { signature?: string; body?: string }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const signature = new Headers(init?.headers).get("PAYMENT-SIGNATURE") ?? undefined;
    seen.push({ signature, body: init?.body ? String(init.body) : undefined });
    if (!signature) {
      const required = {
        x402Version: 2,
        resource: { url },
        accepts: [
          { scheme: "exact", network: X402_NETWORK, asset: AUSD.address, amount, payTo: TREASURY, maxTimeoutSeconds: 300, extra: { ...AUSD.eip712 } },
        ],
      };
      return Response.json({ error: "Payment required" }, { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required) } });
    }
    return Response.json(created, {
      status: 201,
      headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: TX, network: X402_NETWORK }) },
    });
  };
  return { fetchImpl, seen };
}

describe("x402 payments in the MCP client", () => {
  it("reads AGENT_PRIVATE_KEY, falling back to A_EYE_AGENT_PRIVATE_KEY", () => {
    expect(agentPrivateKey({})).toBeUndefined();
    expect(agentPrivateKey({ AGENT_PRIVATE_KEY: "${user_config.agent_private_key}" })).toBeUndefined();
    expect(agentPrivateKey({ A_EYE_AGENT_PRIVATE_KEY: "${user_config.agent_private_key}" })).toBeUndefined();
    expect(agentPrivateKey({ AGENT_PRIVATE_KEY: "${user_config.agent_private_key}", A_EYE_AGENT_PRIVATE_KEY: "ab" })).toBe("0xab");
    expect(agentPrivateKey({ A_EYE_AGENT_PRIVATE_KEY: "ab" })).toBe("0xab");
    expect(agentPrivateKey({ AGENT_PRIVATE_KEY: "0x01", A_EYE_AGENT_PRIVATE_KEY: "0x02" })).toBe("0x01");
    expect(paymentFromEnv({})).toBeUndefined();
  });

  it("pays the 402 with an ERC-3009 AUSD authorization and returns payment_tx from PAYMENT-RESPONSE", async () => {
    const key = generatePrivateKey();
    const { fetchImpl, seen } = paywalledServer("1000000");
    const paying = createPayingFetch(key, { baseFetch: fetchImpl });
    const res = await new AEyeApi(BASE, paying.fetch, "agent", true).askQuestion(input);
    expect(res.payment_tx).toBe(TX);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.body).toBe(seen[0]!.body);
    const payload = decodePaymentSignatureHeader(seen[1]!.signature!);
    expect(payload.accepted).toMatchObject({ asset: AUSD.address, amount: "1000000", extra: { name: "Agora Dollar", version: "1" } });
    expect(payload.payload).toMatchObject({
      authorization: { from: privateKeyToAccount(key).address, to: TREASURY, value: "1000000" },
    });
  });

  it("refuses to pay more than the spend cap", async () => {
    const { fetchImpl, seen } = paywalledServer("30000000");
    const paying = createPayingFetch(generatePrivateKey(), { baseFetch: fetchImpl, maxPaymentUnits: 25_000_000n });
    await expect(new AEyeApi(BASE, paying.fetch, "agent", true).askQuestion(input)).rejects.toThrow();
    expect(seen.filter((s) => s.signature)).toHaveLength(0);
  });

  it("without a key, a 402 becomes an error telling the agent to set AGENT_PRIVATE_KEY", async () => {
    const { fetchImpl } = paywalledServer("1000000");
    await expect(new AEyeApi(BASE, fetchImpl).askQuestion(input)).rejects.toThrow(/Payment required.*AGENT_PRIVATE_KEY/);
  });

  it("parses settlement headers defensively", () => {
    expect(paymentTxFromHeaders(new Headers())).toBeNull();
    expect(paymentTxFromHeaders(new Headers({ "PAYMENT-RESPONSE": "garbage" }))).toBeNull();
    const receipt = { success: true, transaction: TX, network: X402_NETWORK };
    const headers = new Headers({ "X-PAYMENT-RESPONSE": encodePaymentResponseHeader(receipt) });
    expect(paymentResponseFromHeaders(headers)).toEqual(receipt);
    expect(paymentTxFromHeaders(headers)).toBe(TX);
  });

  it("preserves the existing 402 message and exposes decoded payment requirements", async () => {
    const required = {
      x402Version: 2,
      resource: { url: `${BASE}/api/questions` },
      accepts: [
        {
          scheme: "exact",
          network: X402_NETWORK,
          asset: AUSD.address,
          amount: "1000000",
          payTo: TREASURY,
          maxTimeoutSeconds: 300,
          extra: { ...AUSD.eip712 },
        },
      ],
    };
    const api = new AEyeApi(BASE, async () =>
      Response.json(
        { error: "Payment required" },
        { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required) } },
      ),
    );
    await expect(api.askQuestion(input)).rejects.toMatchObject({
      name: "Error",
      message: "Payment required. Set AGENT_PRIVATE_KEY (a Base Sepolia wallet holding AUSD) so the MCP server can pay via x402.",
      status: 402,
      paymentRequired: required,
    } satisfies Partial<PaymentRequiredError>);
  });
});
