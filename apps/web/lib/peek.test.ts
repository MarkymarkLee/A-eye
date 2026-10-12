import { AUSD, CreateQuestionInput, X402_NETWORK } from "@a-eye/shared";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const transferAusd = vi.fn();
const transferAusdViaFacilitator = vi.fn();
const ausdBalance = vi.fn();
vi.mock("./chain", async (orig) => ({
  ...(await orig<typeof import("./chain")>()),
  transferAusd,
  transferAusdViaFacilitator,
  ausdBalance,
}));

const UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "a-eye-peek-"));
const TREASURY = "0x293214291186180810902D97994c2C72fE88255A";
const FACILITATOR = "http://peek-facilitator.test";
const BOUNTY_TX = `0x${"aa".repeat(32)}`;
const PEEK_TX = `0x${"bb".repeat(32)}`;
const PAYOUT_TX = `0x${"cc".repeat(32)}`;
const agent = privateKeyToAccount(generatePrivateKey());
const treasuryKey = generatePrivateKey();
const realFetch = globalThis.fetch;

vi.stubEnv("A_EYE_DB_PATH", ":memory:");
vi.stubEnv("A_EYE_UPLOAD_DIR", UPLOAD_DIR);
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("A_EYE_TREASURY_ADDRESS", TREASURY);
vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", treasuryKey);
vi.stubEnv("A_EYE_PAYOUT_RAIL", "direct");
vi.stubEnv("A_EYE_PEEK_PRICE_USD", "0.02");
vi.stubEnv("ALLOW_UNPAID_QUESTIONS", "");
vi.stubEnv("X402_FACILITATOR_URL", FACILITATOR);
vi.stubEnv("S3_BUCKET", "");
vi.stubEnv("XRPL_TREASURY_SEED", "");
vi.stubEnv("XRPL_ISSUER_SEED", "");

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(FACILITATOR)) throw new Error("offline");
  const operation = url.slice(FACILITATOR.length);
  if (operation === "/supported") {
    return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: X402_NETWORK }], extensions: [], signers: {} });
  }
  const { paymentPayload } = JSON.parse(String(init?.body)) as {
    paymentPayload: { payload: { authorization: { from: string } } };
  };
  const payer = paymentPayload.payload.authorization.from;
  if (operation === "/verify") return Response.json({ isValid: true, payer });
  return Response.json({ success: true, transaction: PEEK_TX, network: X402_NETWORK, payer });
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

const store = await import("./store");
const { GET: resultsGet } = await import("@/app/api/questions/[id]/route");
const { GET: peekGet } = await import("@/app/api/questions/[id]/peek/route");
const { activity } = await import("./activity");
const { winnerPayoutUnits } = await import("./payments");

const questionInput = (overrides: Record<string, unknown> = {}) =>
  CreateQuestionInput.parse({
    lat: 37.8716,
    lng: -122.2536,
    question: "Is the cafe line longer than five people?",
    options: ["Yes", "No"],
    allow_free_text: true,
    prize_usd: 2.5,
    min_responses: 2,
    max_responses: 2,
    closes_in_minutes: 10,
    ...overrides,
  });

const createPaidQuestion = (overrides: Record<string, unknown> = {}) =>
  store.createQuestion(
    questionInput(overrides),
    agent.address,
    { payer: agent.address, tx: BOUNTY_TX },
    "http://a-eye.test",
  );

async function submit(questionId: string, observerId: string, freeText?: string) {
  store.getOrCreateObserver(observerId);
  return store.addSubmission({
    question_id: questionId,
    observer_id: observerId,
    option_index: 0,
    free_text: freeText,
    image: { bytes: new TextEncoder().encode(`photo-${questionId}-${observerId}`), type: "image/jpeg" },
    lat: 37.8716,
    lng: -122.2536,
    accuracy_m: 5,
    distance_m: 4,
    captured_at: new Date().toISOString(),
  });
}

const routeRequest = (questionId: string, resource = "peek") =>
  new Request(`http://a-eye.test/api/questions/${questionId}/${resource}`, { method: "GET" });

const payingClient = new x402Client().register(X402_NETWORK, new ExactEvmScheme(agent)).setSpendControls({
  allowedAssets: [{ network: X402_NETWORK, asset: AUSD.address, maxAmountPerPayment: "100000" }],
});
const paidGet = wrapFetchWithPayment(async (input, init) => {
  const request = new Request(input, init);
  const id = new URL(request.url).pathname.split("/")[3]!;
  return peekGet(request, { params: Promise.resolve({ id }) });
}, payingClient);

describe("pay-per-peek", () => {
  beforeEach(() => {
    vi.stubEnv("A_EYE_PEEK_PRICE_USD", "0.02");
    vi.stubEnv("ALLOW_UNPAID_QUESTIONS", "");
    vi.stubEnv("A_EYE_PAYOUT_RAIL", "direct");
    ausdBalance.mockReset().mockResolvedValue(10n ** 12n);
    transferAusd.mockReset().mockResolvedValue(PAYOUT_TX);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("seals free open results, charges 20,000 units, records the peek, and tops up the paid raffle pot", async () => {
    const questionId = createPaidQuestion();
    const winner = store.getOrCreateObserver("peek-winner");
    store.updateObserver(winner.id, { evm_address: `0x${"22".repeat(20)}` });
    await expect(submit(questionId, winner.id, "maybe")).resolves.toMatchObject({ ok: true, closed: false });

    const freeResults = await resultsGet(routeRequest(questionId, ""), { params: Promise.resolve({ id: questionId }) });
    const sealed = (await freeResults.json()) as {
      sealed: boolean;
      responses: number;
      tally: { count: number; pct: number }[];
      evidence: unknown[];
      peek: { price_usd: number };
    };
    expect(sealed).toMatchObject({ sealed: true, peek: { price_usd: 0.02 }, evidence: [] });
    expect(sealed.responses).toBe(1);
    expect(sealed.tally.every((row) => row.count === 0 && row.pct === 0)).toBe(true);

    const challenge = await peekGet(routeRequest(questionId), { params: Promise.resolve({ id: questionId }) });
    expect(challenge.status).toBe(402);
    const required = decodePaymentRequiredHeader(challenge.headers.get("PAYMENT-REQUIRED")!);
    expect(required.accepts[0]).toMatchObject({ amount: "20000", asset: AUSD.address, payTo: TREASURY });

    const paidResponse = await paidGet(`http://a-eye.test/api/questions/${questionId}/peek`, { method: "GET" });
    expect(paidResponse.status).toBe(200);
    const paid = (await paidResponse.json()) as {
      paid: boolean;
      payment_tx: string;
      sealed?: boolean;
      tally: { count: number }[];
      evidence: unknown[];
      pot_usd: number;
    };
    expect(paid).toMatchObject({ paid: true, payment_tx: PEEK_TX, pot_usd: 2.52 });
    expect(paid.sealed).toBeUndefined();
    expect(paid.tally[0]!.count).toBe(1);
    expect(paid.evidence).toHaveLength(1);
    expect(store.peekRevenue(questionId)).toBe(0.02);
    expect(
      store.db().prepare("select payer_address, amount, payment_tx, responses_at_peek from peeks where question_id = ?").get(questionId),
    ).toMatchObject({ payer_address: agent.address, amount: 0.02, payment_tx: PEEK_TX, responses_at_peek: 1 });

    const live = await activity({ origin: "http://a-eye.test" });
    expect(live.counters.ausd_peeks).toBe(0.02);
    expect(live.counters.onchain_txs).toBeGreaterThanOrEqual(2);
    expect(live.events.find((event) => event.type === "photo" && event.question_id === questionId)).toMatchObject({
      type: "photo",
      answer: "",
      sealed: true,
      free_text: undefined,
    });
    expect(live.events.find((event) => event.type === "peek" && event.question_id === questionId)).toMatchObject({
      type: "peek",
      tx: PEEK_TX,
      amount: 0.02,
      responses_at_peek: 1,
    });

    const secondWinner = store.getOrCreateObserver("peek-second-winner");
    store.updateObserver(secondWinner.id, { evm_address: `0x${"33".repeat(20)}` });
    await expect(submit(questionId, secondWinner.id)).resolves.toMatchObject({ ok: true, closed: true });
    expect(transferAusd).toHaveBeenCalledWith(expect.any(String), winnerPayoutUnits(2.52), expect.anything());

    const final = (await store.getResults(questionId, "http://a-eye.test"))!;
    expect(final.raffle.prize_amount).toBe(2.268);
    expect(final.pot_usd).toBe(2.52);
    expect(final.ausd_flows.map((flow) => flow.kind)).toEqual(["bounty", "peek", "payout"]);
    expect(final.ausd_flows.every((flow) => flow.url.includes("sepolia.basescan.org/tx/"))).toBe(true);
  });

  it("returns final results without payment after close and interim results free in unpaid mode", async () => {
    const closedId = createPaidQuestion({ min_responses: 1, max_responses: 5 });
    await store.closeNow(closedId);
    const closed = await peekGet(routeRequest(closedId), { params: Promise.resolve({ id: closedId }) });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({ status: "expired", paid: false, payment_tx: null });

    const openId = createPaidQuestion();
    vi.stubEnv("ALLOW_UNPAID_QUESTIONS", "1");
    const free = await peekGet(routeRequest(openId), { params: Promise.resolve({ id: openId }) });
    expect(free.status).toBe(200);
    expect(await free.json()).toMatchObject({ status: "open", paid: false, payment_tx: null });
    const api = await resultsGet(routeRequest(openId, ""), { params: Promise.resolve({ id: openId }) });
    expect((await api.json() as { sealed?: boolean }).sealed).toBeUndefined();
  });

  it("refunds only the question bounty when a peeked question expires", async () => {
    const questionId = createPaidQuestion();
    store.recordPeek(questionId, agent.address, 0.02, PEEK_TX);
    await store.closeNow(questionId);
    expect(transferAusd).toHaveBeenCalledExactlyOnceWith(agent.address, 2_500_000n, expect.anything());
    const results = (await store.getResults(questionId, "http://a-eye.test"))!;
    expect(results.status).toBe("expired");
    expect(results.ausd_flows.map((flow) => flow.kind)).toEqual(["bounty", "peek", "refund"]);
    expect(results.ausd_flows.at(-1)).toMatchObject({ kind: "refund", amount: 2.5, to_label: "agent" });
  });
});
