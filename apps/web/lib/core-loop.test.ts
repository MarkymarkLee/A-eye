import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { CreateQuestionInput } from "@a-eye/shared";

const winnerPushSend = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("web-push", () => ({ default: { sendNotification: winnerPushSend } }));
vi.mock("node:dns", () => ({
  promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

const transferAusd = vi.fn();
const ausdTxStatus = vi.fn();
const rebroadcastRawTx = vi.fn();
const transferAusdViaFacilitator = vi.fn();
const ausdAuthorizationUsed = vi.fn();
const findAuthorizationTx = vi.fn();
const currentBlockNumber = vi.fn();
const ausdBalance = vi.fn();
vi.mock("./chain", async (orig) => ({
  ...(await orig<typeof import("./chain")>()),
  transferAusd,
  ausdTxStatus,
  rebroadcastRawTx,
  transferAusdViaFacilitator,
  ausdAuthorizationUsed,
  findAuthorizationTx,
  currentBlockNumber,
  ausdBalance,
}));

vi.stubEnv("A_EYE_DB_PATH", ":memory:");
vi.stubEnv("A_EYE_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "a-eye-core-loop-")));
vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", generatePrivateKey());
vi.stubEnv("A_EYE_TREASURY_ADDRESS", "");
vi.stubEnv("XRPL_TREASURY_SEED", "");
vi.stubEnv("XRPL_ISSUER_SEED", "");

const HANG_URL = "https://hooks.example.com/hang";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === HANG_URL) {
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }
  throw new Error("offline");
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

const { FacilitatorNotSubmittedError } = await import("./chain");
const store = await import("./store");
const { raffleSnippet } = await import("./raffle-snippet");
const { prizeUnits, winnerPayoutUnits } = await import("./payments");

const PAYOUT_TX = `0x${"bb".repeat(32)}`;
const PAYER = "0x00000000000000000000000000000000000000aa";
const PAYMENT_TX = `0x${"aa".repeat(32)}`;

const question = (extra: Record<string, unknown> = {}) => ({
  lat: 37.8716,
  lng: -122.2536,
  radius_m: 150,
  question: "Is the Chou Hall cafe line longer than 5 people?",
  options: ["Yes", "No"],
  prize_usd: 2.5,
  min_responses: 1,
  max_responses: 3,
  closes_in_minutes: 30,
  ...extra,
});

const ask = (extra: Record<string, unknown> = {}, paid?: { payer: string; tx: string | null }) =>
  store.createQuestion(CreateQuestionInput.parse(question(extra)), "core-loop-agent", paid);

const paid = { payer: PAYER, tx: PAYMENT_TX };

let imageNo = 0;
const imageBytes = () => new Uint8Array([0xff, 0xd8, imageNo & 0xff, (imageNo >> 8) & 0xff, imageNo++ & 0x7f, 0x42]);

async function submit(questionId: string, observerId: string, extra: Record<string, unknown> = {}) {
  store.getOrCreateObserver(observerId);
  return store.addSubmission({
    question_id: questionId,
    observer_id: observerId,
    option_index: 0,
    image: { bytes: imageBytes(), type: "image/jpeg" },
    lat: 37.8716,
    lng: -122.2536,
    accuracy_m: 5,
    distance_m: 0,
    captured_at: new Date().toISOString(),
    ...extra,
  });
}

const transfers = (questionId: string) =>
  store.db().prepare("select * from treasury_transfers where question_id = ?").all(questionId) as Record<
    string,
    unknown
  >[];

const NONCE = `0x${"77".repeat(32)}` as `0x${string}`;
const FACILITATOR_TX = `0x${"99".repeat(32)}`;

beforeEach(() => {
  transferAusd.mockReset().mockResolvedValue(PAYOUT_TX);
  ausdTxStatus.mockReset().mockResolvedValue("missing");
  rebroadcastRawTx.mockReset().mockResolvedValue("ok");
  // Default: facilitator rail can't submit (the no-gas reality), so tests exercise fallback-to-direct.
  transferAusdViaFacilitator
    .mockReset()
    .mockRejectedValue(new FacilitatorNotSubmittedError("offline"));
  ausdAuthorizationUsed.mockReset().mockResolvedValue(false);
  findAuthorizationTx.mockReset().mockResolvedValue(undefined);
  currentBlockNumber.mockReset().mockResolvedValue(100n);
  ausdBalance.mockReset().mockResolvedValue(10n ** 12n);
  vi.stubEnv("A_EYE_PAYOUT_RAIL", "");
  vi.stubEnv("VAPID_PUBLIC_KEY", "");
  vi.stubEnv("VAPID_PRIVATE_KEY", "");
  vi.stubEnv("VAPID_SUBJECT", "");
  winnerPushSend.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("core loop correctness", () => {
  it("accepts at most max_responses under concurrent submissions and the raffle covers all evidence", async () => {
    const id = ask();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => submit(id, `race-${id}-${i}`)));
    const ok = results.filter((r) => r.ok);
    const rejected = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(3);
    expect(rejected).toHaveLength(5);
    for (const r of rejected) expect(r).toMatchObject({ ok: false, status: 409 });

    const res = (await store.getResults(id, "http://a-eye.test"))!;
    expect(res.status).toBe("settled");
    expect(res.evidence).toHaveLength(3);
    const verified = await runInNewContext(
      raffleSnippet({
        questionId: id,
        seedReveal: res.raffle.seed_reveal!,
        seedCommit: res.raffle.seed_commit,
        blockHash: res.raffle.entropy_block_hash!,
        submissionIds: res.evidence.map((e) => e.id),
      }),
      { crypto: globalThis.crypto, TextEncoder, console: { log() {} } },
    );
    expect(verified.commit_ok).toBe(true);
    expect(verified.entrants).toBe(3);
    expect(verified.winner).toBe(res.raffle.winner_submission_id);

    // A submission after the question closed is rejected too.
    expect(await submit(id, `race-${id}-late`)).toMatchObject({ ok: false, status: 409 });

    // Same for a question whose closes_at passed while still 'open'.
    const stale = ask();
    store
      .db()
      .prepare("update questions set closes_at = ? where id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), stale);
    expect(await submit(stale, `race-${stale}-late`)).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects duplicate photos, repeat answers and bad option indexes; gates free_text", async () => {
    const id = ask();
    const other = ask();
    const bytes = imageBytes();
    const withImage = (questionId: string, observerId: string, extra: Record<string, unknown> = {}) =>
      store.addSubmission({
        question_id: questionId,
        observer_id: store.getOrCreateObserver(observerId).id,
        option_index: 0,
        image: { bytes, type: "image/jpeg" },
        lat: 37.8716,
        lng: -122.2536,
        accuracy_m: 5,
        distance_m: 0,
        captured_at: new Date().toISOString(),
        ...extra,
      });

    expect(await withImage(id, `dup-${id}-a`)).toMatchObject({ ok: true });
    // Same photo, different observer on the same question -> 409.
    expect(await withImage(id, `dup-${id}-b`)).toMatchObject({ ok: false, status: 409 });
    // Same photo on a different question -> 409.
    expect(await withImage(other, `dup-${id}-c`)).toMatchObject({ ok: false, status: 409 });
    // One answer per observer per question -> 409.
    expect(await submit(id, `dup-${id}-a`)).toMatchObject({ ok: false, status: 409 });
    // option_index out of range -> 422.
    expect(await submit(id, `dup-${id}-d`, { option_index: 2 })).toMatchObject({ ok: false, status: 422 });

    // free_text is dropped when the question doesn't allow it, kept when it does.
    expect(await submit(id, `dup-${id}-e`, { free_text: "sneaky" })).toMatchObject({ ok: true });
    const freeQ = ask({ allow_free_text: true });
    expect(await submit(freeQ, `dup-${id}-f`, { free_text: "all good" })).toMatchObject({ ok: true });

    const stored = (qid: string) =>
      store
        .db()
        .prepare("select free_text from submissions where question_id = ?")
        .all(qid)
        .map((r) => (r as { free_text: string | null }).free_text);
    expect(stored(id).every((t) => t === null)).toBe(true);
    expect(stored(freeQ)).toContain("all good");
  });

  it("expires with zero responses, settles a single response, and tally percentages sum to 100", async () => {
    const zero = ask({ min_responses: 1 });
    await store.closeNow(zero);
    const zeroRes = (await store.getResults(zero, "http://a-eye.test"))!;
    expect(zeroRes.status).toBe("expired");
    expect(zeroRes.tally.every((t) => t.count === 0 && t.pct === 0)).toBe(true);

    const one = ask({ min_responses: 1 });
    expect(await submit(one, `solo-${one}`)).toMatchObject({ ok: true });
    await store.closeNow(one);
    const oneRes = (await store.getResults(one, "http://a-eye.test"))!;
    expect(oneRes.status).toBe("settled");
    expect(oneRes.raffle.winner_submission_id).toBe(oneRes.evidence[0]!.id);

    const many = ask({ min_responses: 1, max_responses: 10 });
    await submit(many, `many-${many}-0`, { option_index: 0 });
    await submit(many, `many-${many}-1`, { option_index: 0 });
    await submit(many, `many-${many}-2`, { option_index: 1 });
    await store.closeNow(many);
    const manyRes = (await store.getResults(many, "http://a-eye.test"))!;
    expect(manyRes.status).toBe("settled");
    expect(manyRes.tally.reduce((s, t) => s + t.pct, 0)).toBeCloseTo(100, 6);
  });

  it("settlement is idempotent under concurrent close/read/sweep", async () => {
    const id = ask({ min_responses: 1 }, paid);
    const obs = store.getOrCreateObserver(`idem-${id}`);
    store.updateObserver(obs.id, { evm_address: "0x00000000000000000000000000000000000000bb" });
    expect(await submit(id, `idem-${id}`)).toMatchObject({ ok: true });
    store
      .db()
      .prepare("update questions set closes_at = ? where id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), id);

    await Promise.all([store.settleDue(), store.settleDue(), store.getResults(id, "http://a-eye.test"), store.closeNow(id)]);
    await store.flushTreasuryTransfers();

    expect(transferAusd).toHaveBeenCalledTimes(1);
    expect(store.db().prepare("select count(*) as n from raffles where question_id = ?").get(id)).toMatchObject({
      n: 1,
    });
    const rows = transfers(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "payout", state: "paid" });
    expect((await store.getResults(id, "http://a-eye.test"))!.raffle.payout_tx).toBe(PAYOUT_TX);
  });

  it("records payment failure and retries the payout after the backoff", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const obs = store.getOrCreateObserver(`retry-${id}`);
    const winner = "0x00000000000000000000000000000000000000cc";
    store.updateObserver(obs.id, { evm_address: winner });
    transferAusd.mockRejectedValue(new Error("insufficient funds for gas"));

    expect(await submit(id, `retry-${id}`)).toMatchObject({ ok: true, closed: true });
    const res = (await store.getResults(id, "http://a-eye.test"))!;
    expect(res.status).toBe("settled");
    expect(res.raffle.payout_tx).toBeUndefined();
    expect(res.raffle.payout_status).toBe("failed");
    expect(transfers(id)[0]).toMatchObject({ kind: "payout", state: "failed", attempts: 1 });
    expect(transferAusd).toHaveBeenCalledTimes(1);

    // A sweep within the 60s backoff does not attempt again.
    vi.setSystemTime(Date.now() + 30_000);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transferAusd).toHaveBeenCalledTimes(1);

    // After the backoff the retry signs (persisting hash+raw) and confirms.
    vi.setSystemTime(Date.now() + 61_000);
    transferAusd.mockImplementation(async (_to, _units, hooks) => {
      hooks?.onSigned?.({ hash: PAYOUT_TX, raw: `0x${"dd".repeat(100)}` });
      return PAYOUT_TX;
    });
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transfers(id)[0]).toMatchObject({ kind: "payout", state: "paid", tx: PAYOUT_TX });
    expect((await store.getResults(id, "http://a-eye.test"))!.raffle.payout_tx).toBe(PAYOUT_TX);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transferAusd).toHaveBeenCalledTimes(2);
  });

  it("records and retries the refund on an expired paid question", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = ask({ min_responses: 3 }, paid);
    transferAusd.mockRejectedValue(new Error("insufficient funds for gas"));
    await store.closeNow(id);
    expect((await store.getResults(id, "http://a-eye.test"))!.status).toBe("expired");
    expect(transfers(id)[0]).toMatchObject({ kind: "refund", state: "failed", attempts: 1 });
    expect(store.db().prepare("select refund_tx from questions where id = ?").get(id)).toMatchObject({
      refund_tx: null,
    });

    vi.setSystemTime(Date.now() + 61_000);
    const REFUND_TX = `0x${"ee".repeat(32)}`;
    transferAusd.mockResolvedValue(REFUND_TX);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transfers(id)[0]).toMatchObject({ kind: "refund", state: "paid", tx: REFUND_TX });
    expect(store.db().prepare("select refund_tx from questions where id = ?").get(id)).toMatchObject({
      refund_tx: REFUND_TX,
    });
  });

  it("backfills a missing payout ledger row and retries it through the facilitator", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `backfill-payout-${id}`;
    const winner = "0x00000000000000000000000000000000000000fa";
    store.updateObserver(store.getOrCreateObserver(observerId).id, { evm_address: winner });
    transferAusd.mockRejectedValueOnce(new Error("insufficient funds for gas"));

    expect(await submit(id, observerId)).toMatchObject({ ok: true, closed: true });
    const original = transfers(id)[0]!;
    expect(original).toMatchObject({ kind: "payout", state: "failed", to_address: winner });
    expect(original.amount_units).toBe("2250000");
    store.db().prepare("delete from treasury_transfers where question_id = ? and kind = 'payout'").run(id);

    expect(store.backfillTreasuryTransfers()).toBe(1);
    expect(transfers(id)[0]).toMatchObject({
      kind: "payout",
      state: "pending",
      to_address: winner,
      amount_units: original.amount_units,
    });

    transferAusdViaFacilitator.mockResolvedValue(FACILITATOR_TX);
    vi.setSystemTime(Date.now() + 61_000);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transfers(id)[0]).toMatchObject({ state: "paid", tx: FACILITATOR_TX });
    expect((await store.getResults(id, "http://a-eye.test"))!.raffle.payout_tx).toBe(FACILITATOR_TX);

    const attempts = transferAusdViaFacilitator.mock.calls.length;
    expect(store.backfillTreasuryTransfers()).toBe(0);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transferAusdViaFacilitator).toHaveBeenCalledTimes(attempts);
  });

  it("backfills a missing refund ledger row for an expired paid question", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = ask({ min_responses: 3 }, paid);
    transferAusd.mockRejectedValueOnce(new Error("insufficient funds for gas"));
    await store.closeNow(id);
    const original = transfers(id)[0]!;
    expect(original).toMatchObject({ kind: "refund", state: "failed", to_address: PAYER });
    store.db().prepare("delete from treasury_transfers where question_id = ? and kind = 'refund'").run(id);

    expect(store.backfillTreasuryTransfers()).toBe(1);
    expect(transfers(id)[0]).toMatchObject({
      kind: "refund",
      state: "pending",
      to_address: PAYER,
      amount_units: prizeUnits(2.5).toString(),
    });

    transferAusdViaFacilitator.mockResolvedValue(FACILITATOR_TX);
    vi.setSystemTime(Date.now() + 61_000);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transfers(id)[0]).toMatchObject({ state: "paid", tx: FACILITATOR_TX });
    expect(store.db().prepare("select refund_tx from questions where id = ?").get(id)).toMatchObject({
      refund_tx: FACILITATOR_TX,
    });
  });

  it("does not backfill payouts or refunds already accounted for by settlement", async () => {
    const paidId = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `backfill-done-${paidId}`;
    store.updateObserver(store.getOrCreateObserver(observerId).id, {
      evm_address: "0x00000000000000000000000000000000000000fb",
    });
    transferAusdViaFacilitator.mockResolvedValue(FACILITATOR_TX);
    expect(await submit(paidId, observerId)).toMatchObject({ ok: true, closed: true });
    expect(store.db().prepare("select payout_tx from raffles where question_id = ?").get(paidId)).toMatchObject({
      payout_tx: FACILITATOR_TX,
    });
    store.db().prepare("delete from treasury_transfers where question_id = ? and kind = 'payout'").run(paidId);
    store.backfillTreasuryTransfers();
    expect(transfers(paidId)).toHaveLength(0);

    const unpaidId = ask({ min_responses: 1, max_responses: 1 });
    expect(await submit(unpaidId, `backfill-unpaid-${unpaidId}`)).toMatchObject({ ok: true, closed: true });
    store.backfillTreasuryTransfers();
    expect(transfers(unpaidId)).toHaveLength(0);

    const refundedId = ask({ min_responses: 3 }, paid);
    await store.closeNow(refundedId);
    expect(store.db().prepare("select refund_tx from questions where id = ?").get(refundedId)).toMatchObject({
      refund_tx: FACILITATOR_TX,
    });
    store.db().prepare("delete from treasury_transfers where question_id = ? and kind = 'refund'").run(refundedId);
    store.backfillTreasuryTransfers();
    expect(transfers(refundedId)).toHaveLength(0);
  });

  it("keeps facilitator insufficient-AUSD failures retryable without using the direct rail", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `balance-error-${id}`;
    store.updateObserver(store.getOrCreateObserver(observerId).id, {
      evm_address: "0x00000000000000000000000000000000000000fc",
    });
    transferAusdViaFacilitator.mockRejectedValueOnce(
      new FacilitatorNotSubmittedError(
        "invalid_exact_evm_token_name_mismatch: execution reverted 0xe450d38c ERC20InsufficientBalance",
      ),
    );

    expect(await submit(id, observerId)).toMatchObject({ ok: true, closed: true });
    expect(transfers(id)[0]).toMatchObject({
      state: "failed",
      last_error: expect.stringMatching(/^insufficient_treasury_balance:/),
    });
    expect(transferAusd).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 30_000);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transferAusdViaFacilitator).toHaveBeenCalledTimes(1);
    expect(transferAusd).not.toHaveBeenCalled();

    transferAusdViaFacilitator.mockResolvedValue(FACILITATOR_TX);
    vi.setSystemTime(Date.now() + 31_000);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transfers(id)[0]).toMatchObject({ state: "paid", tx: FACILITATOR_TX });
  });

  it("prechecks treasury AUSD and retries after the balance is restored", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    ausdBalance.mockResolvedValueOnce(0n);
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `balance-low-${id}`;
    store.updateObserver(store.getOrCreateObserver(observerId).id, {
      evm_address: "0x00000000000000000000000000000000000000fd",
    });

    expect(await submit(id, observerId)).toMatchObject({ ok: true, closed: true });
    expect(transfers(id)[0]).toMatchObject({
      state: "failed",
      last_error: expect.stringMatching(/^insufficient_treasury_balance: have 0 need /),
    });
    expect(transferAusdViaFacilitator).not.toHaveBeenCalled();
    expect(transferAusd).not.toHaveBeenCalled();

    ausdBalance.mockResolvedValue(10n ** 12n);
    transferAusdViaFacilitator.mockResolvedValue(FACILITATOR_TX);
    vi.setSystemTime(Date.now() + 61_000);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transfers(id)[0]).toMatchObject({ state: "paid", tx: FACILITATOR_TX });
  });

  it("continues to the facilitator when the treasury balance RPC fails", async () => {
    ausdBalance.mockRejectedValueOnce(new Error("RPC down"));
    transferAusdViaFacilitator.mockResolvedValue(FACILITATOR_TX);
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `balance-rpc-${id}`;
    store.updateObserver(store.getOrCreateObserver(observerId).id, {
      evm_address: "0x00000000000000000000000000000000000000fe",
    });

    expect(await submit(id, observerId)).toMatchObject({ ok: true, closed: true });
    expect(ausdBalance).toHaveBeenCalledTimes(1);
    expect(transferAusdViaFacilitator).toHaveBeenCalledTimes(1);
    expect(transferAusd).not.toHaveBeenCalled();
    expect(transfers(id)[0]).toMatchObject({ state: "paid", tx: FACILITATOR_TX });
  });

  it("waits for the winner's EVM address and pays once it appears", async () => {
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `addr-${id}`;
    expect(await submit(id, observerId)).toMatchObject({ ok: true, closed: true });
    const res = (await store.getResults(id, "http://a-eye.test"))!;
    expect(res.raffle.payout_status).toBe("awaiting_address");
    expect(transferAusd).not.toHaveBeenCalled();

    const evm = "0x00000000000000000000000000000000000000dd";
    store.updateObserver(store.getOrCreateObserver(observerId).id, { evm_address: evm });
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transferAusd).toHaveBeenCalledWith(evm, BigInt(2_250_000), expect.anything());
    expect(transfers(id)[0]).toMatchObject({ state: "paid", to_address: evm });
  });

  it("retries a prize after its wallet is set and claims concurrent retries only once", async () => {
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observer = store.getOrCreateObserver(`wallet-retry-${id}`);
    expect(await submit(id, `wallet-retry-${id}`)).toMatchObject({ ok: true, closed: true });
    expect(transfers(id)[0]).toMatchObject({ kind: "payout", state: "pending", to_address: null });
    expect(store.observerPrizes(observer.id)).toMatchObject([{ question_id: id, status: "needs_wallet" }]);

    const address = "0x00000000000000000000000000000000000000da";
    store.updateObserver(observer.id, { evm_address: address });
    store.retryWinnerPayouts(observer.id);
    store.retryWinnerPayouts(observer.id);
    await store.settleDue();
    await store.flushTreasuryTransfers();

    expect(transferAusd).toHaveBeenCalledTimes(1);
    expect(transfers(id)[0]).toMatchObject({ kind: "payout", state: "paid", to_address: address, tx: PAYOUT_TX });
    expect(store.observerPrizes(observer.id)).toMatchObject([
      {
        question_id: id,
        rail: "ausd",
        status: "paid",
        receipt_url: `https://sepolia.basescan.org/tx/${PAYOUT_TX}`,
      },
    ]);
  });

  it("sends one winner-only push after settlement and does not repeat on a resumed sweep", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "BPubKey");
    vi.stubEnv("VAPID_PRIVATE_KEY", "PrivKey");
    vi.stubEnv("VAPID_SUBJECT", "https://a-eye.test");
    const id = ask({ min_responses: 1, max_responses: 1, place_label: "Chou Hall" }, paid);
    const winnerId = `push-winner-${id}`;
    const otherId = `push-other-${id}`;
    store.savePushSubscription({
      observerId: store.getOrCreateObserver(winnerId).id,
      endpoint: `https://fcm.googleapis.com/winner/${id}`,
      p256dh: "winner-key",
      auth: "winner-auth",
    });
    store.savePushSubscription({
      observerId: store.getOrCreateObserver(otherId).id,
      endpoint: `https://fcm.googleapis.com/other/${id}`,
      p256dh: "other-key",
      auth: "other-auth",
    });

    expect(await submit(id, winnerId)).toMatchObject({ ok: true, closed: true });
    await store.flushWinnerPushes();
    expect(winnerPushSend).toHaveBeenCalledTimes(1);
    const [subscription, rawPayload, options] = winnerPushSend.mock.calls[0]!;
    expect(subscription.endpoint).toBe(`https://fcm.googleapis.com/winner/${id}`);
    expect(JSON.parse(rawPayload)).toEqual({
      title: "You won!",
      body: "You won 2.25 test dollars at Chou Hall — tap to collect",
      url: `/me?prize=${id}`,
      tag: `won-${id}`,
    });
    expect(options).toMatchObject({ TTL: 86_400, urgency: "high" });

    store.db()
      .prepare("update questions set status = 'closed', closed_at = ? where id = ?")
      .run(new Date(Date.now() - 3 * 60_000).toISOString(), id);
    expect(await store.settleDue()).toBe(1);
    await store.flushWinnerPushes();
    expect(winnerPushSend).toHaveBeenCalledTimes(1);
  });

  it("does not notify for an unpaid winner and removes subscriptions rejected with 410", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "BPubKey");
    vi.stubEnv("VAPID_PRIVATE_KEY", "PrivKey");
    vi.stubEnv("VAPID_SUBJECT", "https://a-eye.test");
    const unpaid = ask({ min_responses: 1, max_responses: 1 });
    const unpaidObserver = `push-unpaid-${unpaid}`;
    store.savePushSubscription({
      observerId: store.getOrCreateObserver(unpaidObserver).id,
      endpoint: `https://fcm.googleapis.com/unpaid/${unpaid}`,
      p256dh: "k",
      auth: "a",
    });
    expect(await submit(unpaid, unpaidObserver)).toMatchObject({ ok: true, closed: true });
    await store.flushWinnerPushes();
    expect(winnerPushSend).not.toHaveBeenCalled();

    const gone = ask({ min_responses: 1, max_responses: 1 }, paid);
    const goneObserver = `push-gone-${gone}`;
    const endpoint = `https://fcm.googleapis.com/gone/${gone}`;
    store.savePushSubscription({
      observerId: store.getOrCreateObserver(goneObserver).id,
      endpoint,
      p256dh: "k",
      auth: "a",
    });
    winnerPushSend.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    expect(await submit(gone, goneObserver)).toMatchObject({ ok: true, closed: true });
    await store.flushWinnerPushes();
    expect(store.pushSubscriptionsFor(store.getOrCreateObserver(goneObserver).id).map((sub) => sub.endpoint)).not.toContain(endpoint);
  });

  it("an XRPL-rail winner of a non-escrowed question still awaits an AUSD address", async () => {
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `xrpl-${id}`;
    store.updateObserver(store.getOrCreateObserver(observerId).id, {
      payout_rail: "xrpl",
      xrpl_address: "rWinnerXrplAddress",
    });
    expect(await submit(id, observerId)).toMatchObject({ ok: true, closed: true });
    const res = (await store.getResults(id, "http://a-eye.test"))!;
    expect(res.raffle.payout_status).toBe("awaiting_address");
    expect(transferAusd).not.toHaveBeenCalled();
  });

  it("resumes a settlement stuck in 'closed' and finishes stuck transfer rows", async () => {
    await store.settleDue(); // drain anything already due
    vi.useFakeTimers({ toFake: ["Date"] });

    const stuckId = ask({ min_responses: 1 });
    expect(await submit(stuckId, `stuck-${stuckId}`)).toMatchObject({ ok: true });
    const recentId = ask({ min_responses: 1 });
    store
      .db()
      .prepare("update questions set status = 'closed', closed_at = ? where id = ?")
      .run(new Date(Date.now() - 3 * 60_000).toISOString(), stuckId);
    store
      .db()
      .prepare("update questions set status = 'closed', closed_at = ? where id = ?")
      .run(new Date(Date.now() - 10_000).toISOString(), recentId);

    expect(await store.settleDue()).toBe(1);
    const stuckRes = (await store.getResults(stuckId, "http://a-eye.test"))!;
    expect(stuckRes.status).toBe("settled");
    expect(stuckRes.raffle.winner_submission_id).toBeTruthy();
    expect(store.db().prepare("select status from questions where id = ?").get(recentId)).toMatchObject({
      status: "closed",
    });
  });

  it("recovers 'sending' transfer rows without double-sending", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const SIGNED_TX = `0x${"cc".repeat(32)}`;
    const SIGNED_RAW = `0x${"dd".repeat(100)}`;

    const makeSending = async () => {
      const id = ask({ min_responses: 1, max_responses: 1 }, paid);
      const observerId = `send-${id}`;
      store.updateObserver(store.getOrCreateObserver(observerId).id, {
        evm_address: "0x00000000000000000000000000000000000000ee",
      });
      expect(await submit(id, observerId)).toMatchObject({ ok: true, closed: true });
      store
        .db()
        .prepare(
          "update treasury_transfers set state = 'sending', tx = ?, raw_tx = ?, updated_at = ? where question_id = ? and kind = 'payout'",
        )
        .run(SIGNED_TX, SIGNED_RAW, new Date(Date.now() - 6 * 60_000).toISOString(), id);
      return id;
    };

    // (b1) The signed tx actually landed: mark paid without a fresh transfer.
    const mined = await makeSending();
    transferAusd.mockClear();
    ausdTxStatus.mockResolvedValue("success");
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transferAusd).not.toHaveBeenCalled();
    expect(rebroadcastRawTx).not.toHaveBeenCalled();
    expect(transfers(mined)[0]).toMatchObject({ state: "paid", tx: SIGNED_TX });

    // (b2) The signed tx was never mined: rebroadcast the persisted raw tx.
    const lost = await makeSending();
    transferAusd.mockClear();
    ausdTxStatus.mockResolvedValue("missing");
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transferAusd).not.toHaveBeenCalled();
    expect(rebroadcastRawTx).toHaveBeenCalledWith(SIGNED_RAW);
    expect(transfers(lost)[0]).toMatchObject({ state: "sent" });

    // (c) 'sending' with nothing signed: claim expired, so sign a fresh transaction.
    const unsigned = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `send-${unsigned}`;
    store.updateObserver(store.getOrCreateObserver(observerId).id, {
      evm_address: "0x00000000000000000000000000000000000000ee",
    });
    expect(await submit(unsigned, observerId)).toMatchObject({ ok: true, closed: true });
    store
      .db()
      .prepare(
        "update treasury_transfers set state = 'sending', tx = null, raw_tx = null, updated_at = ? where question_id = ? and kind = 'payout'",
      )
      .run(new Date(Date.now() - 6 * 60_000).toISOString(), unsigned);
    transferAusd.mockClear();
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transferAusd).toHaveBeenCalledTimes(1);
    expect(transfers(unsigned)[0]).toMatchObject({ state: "paid", tx: PAYOUT_TX });
  });

  it("payoutAmount comes from base units; prize_usd and options are validated", async () => {
    expect(store.payoutAmount(2.5)).toBe(2.25);
    expect(store.payoutAmount(0.01)).toBe(0.009);
    expect(store.payoutAmount(0.015)).toBe(0.0135);
    expect(store.payoutAmount(0.333333)).toBe(0.299999);
    expect(winnerPayoutUnits(2.5)).toBe(BigInt(2_250_000));
    expect(prizeUnits(0.01)).toBe(BigInt(10_000));

    const base = question();
    for (const prize of [0.0000001, 0.005, 1.0000004]) {
      expect(CreateQuestionInput.safeParse({ ...base, prize_usd: prize }).success).toBe(false);
    }
    for (const prize of [0.01, 0.123456]) {
      expect(CreateQuestionInput.safeParse({ ...base, prize_usd: prize }).success).toBe(true);
    }
    expect(CreateQuestionInput.safeParse({ ...base, options: ["Yes", "yes"] }).success).toBe(false);
    expect(CreateQuestionInput.safeParse({ ...base, options: [" Yes ", "yes"] }).success).toBe(false);
  });

  it("pays via the facilitator rail without touching transferAusd", async () => {
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `fac-${id}`;
    store.updateObserver(store.getOrCreateObserver(observerId).id, {
      evm_address: "0x00000000000000000000000000000000000000ee",
    });
    transferAusdViaFacilitator.mockImplementation(async (_to, _units, _fac, hooks) => {
      hooks?.onAuthorized?.({ nonce: NONCE, validBefore: Math.floor(Date.now() / 1000) + 300 });
      return FACILITATOR_TX;
    });
    expect(await submit(id, observerId)).toMatchObject({ ok: true, closed: true });
    expect(transferAusdViaFacilitator).toHaveBeenCalledTimes(1);
    expect(transferAusd).not.toHaveBeenCalled();
    expect(transfers(id)[0]).toMatchObject({ state: "paid", tx: FACILITATOR_TX, rail: "facilitator" });
    expect((await store.getResults(id, "http://a-eye.test"))!.raffle.payout_tx).toBe(FACILITATOR_TX);
  });

  it("A_EYE_PAYOUT_RAIL=direct skips the facilitator rail", async () => {
    vi.stubEnv("A_EYE_PAYOUT_RAIL", "direct");
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `dir-${id}`;
    store.updateObserver(store.getOrCreateObserver(observerId).id, {
      evm_address: "0x00000000000000000000000000000000000000ee",
    });
    expect(await submit(id, observerId)).toMatchObject({ ok: true, closed: true });
    expect(transferAusdViaFacilitator).not.toHaveBeenCalled();
    expect(transferAusd).toHaveBeenCalledTimes(1);
    expect(transfers(id)[0]).toMatchObject({ state: "paid", tx: PAYOUT_TX });
  });

  it("recovers an authorization the facilitator may have broadcast", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `auth-${id}`;
    store.updateObserver(store.getOrCreateObserver(observerId).id, {
      evm_address: "0x00000000000000000000000000000000000000ee",
    });
    const validBefore = Math.floor(Date.now() / 1000) + 300;
    transferAusdViaFacilitator.mockImplementation(async (_to, _units, _fac, hooks) => {
      hooks?.onAuthorized?.({ nonce: NONCE, validBefore });
      throw new Error("timeout");
    });

    expect(await submit(id, observerId)).toMatchObject({ ok: true, closed: true });
    expect(transfers(id)[0]).toMatchObject({
      state: "sent",
      rail: "facilitator",
      auth_nonce: NONCE,
      auth_valid_before: validBefore,
    });
    expect(transferAusd).not.toHaveBeenCalled();

    // Sweep while the authorization is still live: nothing new is signed.
    vi.setSystemTime(Date.now() + 31_000);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transferAusdViaFacilitator).toHaveBeenCalledTimes(1);
    expect(transferAusd).not.toHaveBeenCalled();
    expect(transfers(id)[0]).toMatchObject({ state: "sent" });

    // The authorization lands later: the tx hash is recovered from the event log.
    vi.setSystemTime(Date.now() + 31_000);
    ausdAuthorizationUsed.mockResolvedValue(true);
    findAuthorizationTx.mockResolvedValue(FACILITATOR_TX);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transfers(id)[0]).toMatchObject({ state: "paid", tx: FACILITATOR_TX });
    expect(transferAusdViaFacilitator).toHaveBeenCalledTimes(1);
    expect(transferAusd).not.toHaveBeenCalled();
    expect((await store.getResults(id, "http://a-eye.test"))!.raffle.payout_tx).toBe(FACILITATOR_TX);
  });

  it("signs a fresh authorization only after the old one is dead", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `dead-${id}`;
    store.updateObserver(store.getOrCreateObserver(observerId).id, {
      evm_address: "0x00000000000000000000000000000000000000ee",
    });
    const validBefore = Math.floor(Date.now() / 1000) + 300;
    transferAusdViaFacilitator.mockImplementationOnce(async (_to, _units, _fac, hooks) => {
      hooks?.onAuthorized?.({ nonce: NONCE, validBefore });
      throw new Error("timeout");
    });
    expect(await submit(id, observerId)).toMatchObject({ ok: true, closed: true });
    expect(transfers(id)[0]).toMatchObject({ state: "sent", auth_nonce: NONCE });

    // validBefore + grace passes with the nonce still unused -> exactly one new attempt.
    vi.setSystemTime(Date.now() + 331_000);
    transferAusdViaFacilitator.mockResolvedValue(FACILITATOR_TX);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transferAusdViaFacilitator).toHaveBeenCalledTimes(2);
    expect(transferAusd).not.toHaveBeenCalled();
    expect(transfers(id)[0]).toMatchObject({ state: "paid", tx: FACILITATOR_TX });
  });

  it("no-gas reality: facilitator down + direct out of gas fails, a later facilitator retry pays", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = ask({ min_responses: 1, max_responses: 1 }, paid);
    const observerId = `gas-${id}`;
    store.updateObserver(store.getOrCreateObserver(observerId).id, {
      evm_address: "0x00000000000000000000000000000000000000ee",
    });
    transferAusdViaFacilitator.mockRejectedValueOnce(new FacilitatorNotSubmittedError("insufficient funds for gas"));
    transferAusd.mockRejectedValue(new Error("insufficient funds for gas"));
    expect(await submit(id, observerId)).toMatchObject({ ok: true, closed: true });
    expect(transfers(id)[0]).toMatchObject({ state: "failed", attempts: 1 });
    expect((await store.getResults(id, "http://a-eye.test"))!.raffle.payout_status).toBe("failed");
    expect(transferAusd).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 61_000);
    transferAusdViaFacilitator.mockResolvedValue(FACILITATOR_TX);
    await store.settleDue();
    await store.flushTreasuryTransfers();
    expect(transfers(id)[0]).toMatchObject({ state: "paid", tx: FACILITATOR_TX });
    expect(transferAusdViaFacilitator).toHaveBeenCalledTimes(2);
    expect(transferAusd).toHaveBeenCalledTimes(1);
  });

  it("a hanging webhook does not block closeNow and is recorded failed", async () => {
    const id = ask({ webhook_url: HANG_URL });
    await store.closeNow(id);
    // closeNow resolved while the webhook fetch is still in flight.
    expect((await store.getResults(id, "http://a-eye.test"))!.status).toBe("expired");
    await store.flushWebhooks();
    expect(store.db().prepare("select webhook_state from questions where id = ?").get(id)).toMatchObject({
      webhook_state: "failed",
    });
  }, 30_000);

  it("nearbyQuestions finds questions across the antimeridian and near the poles", async () => {
    const anti = ask({ lat: 0, lng: 179.9995 });
    const pole = ask({ lat: 89.9999, lng: 0 });
    const acrossAnti = await store.nearbyQuestions(0, -179.9995, 1);
    expect(acrossAnti.map((q) => q.id)).toContain(anti);
    const nearPole = await store.nearbyQuestions(89.9999, 180, 1);
    expect(nearPole.map((q) => q.id)).toContain(pole);
  });
});
