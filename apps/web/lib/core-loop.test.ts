import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { CreateQuestionInput } from "@a-eye/shared";

vi.mock("server-only", () => ({}));
vi.mock("node:dns", () => ({
  promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

const transferAusd = vi.fn();
const ausdTxStatus = vi.fn();
const rebroadcastRawTx = vi.fn();
vi.mock("./chain", async (orig) => ({
  ...(await orig<typeof import("./chain")>()),
  transferAusd,
  ausdTxStatus,
  rebroadcastRawTx,
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

beforeEach(() => {
  transferAusd.mockReset().mockResolvedValue(PAYOUT_TX);
  ausdTxStatus.mockReset().mockResolvedValue("missing");
  rebroadcastRawTx.mockReset().mockResolvedValue("ok");
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
