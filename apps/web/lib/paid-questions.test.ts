import { AUSD } from "@a-eye/shared";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const transferAusd = vi.fn();
const transferAusdViaFacilitator = vi.fn();
vi.mock("./chain", async (orig) => ({ ...(await orig<typeof import("./chain")>()), transferAusd, transferAusdViaFacilitator }));

const TREASURY = "0x293214291186180810902D97994c2C72fE88255A";
const PAYMENT_TX = `0x${"aa".repeat(32)}`;
const PAYOUT_TX = `0x${"bb".repeat(32)}`;
const FACILITATOR = "http://facilitator.test";
const agent = privateKeyToAccount(generatePrivateKey());

vi.stubEnv("A_EYE_DB_PATH", ":memory:");
vi.stubEnv("A_EYE_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "a-eye-uploads-")));
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("A_EYE_TREASURY_ADDRESS", TREASURY);
vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", generatePrivateKey());
vi.stubEnv("X402_FACILITATOR_URL", FACILITATOR);

// The x402.org facilitator API, emulated over fetch. Everything else (the entropy RPC) is offline.
const facilitatorCalls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(FACILITATOR)) throw new Error("offline");
  const op = url.slice(FACILITATOR.length);
  facilitatorCalls.push(op);
  if (op === "/supported") return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: [], signers: {} });
  const { paymentPayload } = JSON.parse(String(init?.body));
  const payer = paymentPayload.payload.authorization.from;
  if (op === "/verify") return Response.json({ isValid: true, payer });
  return Response.json({ success: true, transaction: PAYMENT_TX, network: "eip155:84532", payer });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

const { POST } = await import("@/app/api/questions/route");
const store = await import("./store");

const question = (extra: Record<string, unknown> = {}) => ({
  lat: 37.8716,
  lng: -122.2536,
  question: "Is the Chou Hall cafe line longer than 5 people?",
  options: ["Yes", "No"],
  prize_usd: 2.5,
  min_responses: 1,
  max_responses: 1,
  ...extra,
});
const post = (body: unknown) =>
  new Request("http://a-eye.test/api/questions", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const payingClient = new x402Client().register("eip155:84532", new ExactEvmScheme(agent)).setSpendControls({
  allowedAssets: [{ network: "eip155:84532", asset: AUSD.address, maxAmountPerPayment: "25000000" }],
});
const paidPost = wrapFetchWithPayment((input, init) => POST(new Request(input, init)), payingClient);

async function askPaid(extra: Record<string, unknown> = {}) {
  const res = await paidPost("http://a-eye.test/api/questions", { method: "POST", body: JSON.stringify(question(extra)) });
  expect(res.status).toBe(201);
  return { res, body: (await res.json()) as { question_id: string; payment_tx: string | null } };
}

describe("x402-paid POST /api/questions + settlement payouts", () => {
  beforeEach(() => {
    transferAusd.mockReset();
    transferAusd.mockResolvedValue(PAYOUT_TX);
    transferAusdViaFacilitator.mockReset().mockRejectedValue(new Error("facilitator unavailable"));
    vi.stubEnv("ALLOW_UNPAID_QUESTIONS", "");
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("challenges with a 402 for prize_usd in AUSD paid to the treasury", async () => {
    const res = await POST(post(question()));
    expect(res.status).toBe(402);
    const required = decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!);
    expect(required.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:84532",
      asset: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
      amount: "2500000",
      payTo: TREASURY,
      extra: { name: "Agora Dollar", version: "1" },
    });
  });

  it("rejects an invalid question with 400 before asking for payment", async () => {
    expect((await POST(post({ question: "?" }))).status).toBe(400);
  });

  it("creates the question after verify + settle, stores it under the payer and returns payment_tx", async () => {
    const { res, body } = await askPaid();
    expect(body.payment_tx).toBe(PAYMENT_TX);
    expect(decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE")!).transaction).toBe(PAYMENT_TX);
    expect(facilitatorCalls).toEqual(expect.arrayContaining(["/supported", "/verify", "/settle"]));
    const mine = await store.questionsByAgent(agent.address, "http://a-eye.test");
    expect(mine.map((q) => q.id)).toContain(body.question_id);
  });

  it("refunds the payer when a paid question expires without enough answers", async () => {
    const { body } = await askPaid();
    await store.closeNow(body.question_id);
    expect(transferAusd).toHaveBeenCalledExactlyOnceWith(agent.address, BigInt(2_500_000));
    expect((await store.getResults(body.question_id, "http://a-eye.test"))!.status).toBe("expired");
  });

  it("pays the raffle winner the prize minus the 10% fee and stores payout_tx", async () => {
    const { body } = await askPaid();
    const winner = privateKeyToAccount(generatePrivateKey()).address;
    const obs = store.getOrCreateObserver(undefined);
    store.updateObserver(obs.id, { evm_address: winner });
    const sub = await store.addSubmission({
      question_id: body.question_id,
      observer_id: obs.id,
      option_index: 0,
      image: { bytes: new Uint8Array([0xff, 0xd8, 1, 2, 3]), type: "image/jpeg" },
      lat: 37.8716,
      lng: -122.2536,
      accuracy_m: 5,
      distance_m: 0,
      captured_at: new Date().toISOString(),
    });
    expect(sub).toMatchObject({ ok: true, closed: true });
    expect(transferAusd).toHaveBeenCalledExactlyOnceWith(winner, BigInt(2_250_000));
    const results = (await store.getResults(body.question_id, "http://a-eye.test"))!;
    expect(results.status).toBe("settled");
    expect(results.raffle.payout_tx).toBe(PAYOUT_TX);
  });

  it("ALLOW_UNPAID_QUESTIONS=1 skips x402, and unpaid questions never trigger treasury transfers", async () => {
    vi.stubEnv("ALLOW_UNPAID_QUESTIONS", "1");
    const res = await POST(post(question()));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { question_id: string; payment_tx: string | null };
    expect(body.payment_tx).toBeNull();
    await store.closeNow(body.question_id);
    expect(transferAusd).not.toHaveBeenCalled();
  });
});
