import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const transferAusd = vi.fn();
const transferAusdViaFacilitator = vi.fn();
const ausdBalance = vi.fn();
vi.mock("./chain", async (original) => ({
  ...(await original<typeof import("./chain")>()),
  transferAusd,
  transferAusdViaFacilitator,
  ausdBalance,
}));

const uploadDir = mkdtempSync(path.join(tmpdir(), "a-eye-activity-"));
const realFetch = globalThis.fetch;
vi.stubEnv("A_EYE_DB_PATH", ":memory:");
vi.stubEnv("A_EYE_UPLOAD_DIR", uploadDir);
vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", `0x${"11".repeat(32)}`);
vi.stubGlobal(
  "fetch",
  (async () => {
    throw new Error("offline");
  }) as typeof fetch,
);

afterAll(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(uploadDir, { recursive: true, force: true });
});

const { FacilitatorNotSubmittedError } = await import("./chain");
const store = await import("./store");
const { activity } = await import("./activity");
const { raffleSnippet } = await import("./raffle-snippet");
const { GET } = await import("@/app/api/activity/route");

const PAYMENT_TX = `0x${"aa".repeat(32)}`;
const PAYOUT_TX = `0x${"bb".repeat(32)}`;

function ask(overrides: { min_responses?: number; max_responses?: number } = {}, paid = false) {
  const input = {
    lat: 37.8716,
    lng: -122.2536,
    radius_m: 150,
    question: "Is the cafe line longer than five people?",
    options: ["Yes", "No"],
    allow_free_text: false,
    prize_usd: 2.5,
    min_responses: 2,
    max_responses: 5,
    closes_in_minutes: 10,
    ...overrides,
  };
  return store.createQuestion(
    input,
    "activity-test-agent",
    paid ? { payer: "0xactivity-agent", tx: PAYMENT_TX } : undefined,
  );
}

async function submit(questionId: string, observerId: string, optionIndex: number, imageNo: number) {
  store.getOrCreateObserver(observerId);
  return store.addSubmission({
    question_id: questionId,
    observer_id: observerId,
    option_index: optionIndex,
    image: { bytes: new TextEncoder().encode(`jpeg-${questionId}-${imageNo}`), type: "image/jpeg" },
    lat: 37.8716,
    lng: -122.2536,
    accuracy_m: 5,
    distance_m: 4,
    captured_at: new Date().toISOString(),
  });
}

describe("activity feed", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOW_UNPAID_QUESTIONS", "1");
    transferAusd.mockReset().mockResolvedValue(PAYOUT_TX);
    transferAusdViaFacilitator.mockReset().mockRejectedValue(new FacilitatorNotSubmittedError("facilitator unavailable"));
    ausdBalance.mockReset().mockResolvedValue(10n ** 12n);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("emits questions, verified photos, settlement, raffle, payout, counters, and since filtering", async () => {
    const origin = "http://a-eye.test";
    const before = await activity({ origin });

    const freeId = ask();
    const firstAsked = await activity({ origin });
    const asked = firstAsked.events.find((event) => event.id === `question_asked:${freeId}`);
    expect(asked).toMatchObject({ type: "question_asked", question_id: freeId });

    expect(await submit(freeId, `activity-${freeId}-one`, 0, 1)).toMatchObject({ ok: true });
    expect(await submit(freeId, `activity-${freeId}-two`, 1, 2)).toMatchObject({ ok: true });
    expect(await submit(freeId, `activity-${freeId}-three`, 0, 3)).toMatchObject({ ok: true });
    const withPhotos = await activity({ origin });
    const photos = withPhotos.events.filter(
      (event): event is Extract<(typeof withPhotos.events)[number], { type: "photo" }> =>
        event.type === "photo" && event.question_id === freeId,
    );
    expect(photos).toHaveLength(3);
    expect(photos.map((photo) => photo.answer).sort()).toEqual(["No", "Yes", "Yes"]);
    expect(photos[0]).toMatchObject({ type: "photo", distance_m: 4, accuracy_m: 5 });
    expect((photos[0] as Extract<(typeof photos)[number], { type: "photo" }>).thumb_url).toContain(
      `${origin}/api/images/submissions/${freeId}/`,
    );
    expect((photos[0] as Extract<(typeof photos)[number], { type: "photo" }>).observer).toMatch(/^observer-/);

    await store.closeNow(freeId);
    const freeResults = (await store.getResults(freeId, origin))!;
    const feed = await activity({ origin });
    const closed = feed.events.find((event) => event.id === `question_closed:${freeId}`);
    expect(closed).toMatchObject({
      type: "question_closed",
      status: "settled",
      responses: 3,
      leader: { option: "Yes", count: 2 },
    });
    const reveal = feed.events.find((event) => event.id === `raffle_reveal:${freeId}`);
    expect(reveal).toMatchObject({ type: "raffle_reveal", entrants: 3 });
    const verifiedDraw = await runInNewContext(
      raffleSnippet({
        questionId: freeId,
        seedReveal: freeResults.raffle.seed_reveal!,
        seedCommit: freeResults.raffle.seed_commit,
        blockHash: freeResults.raffle.entropy_block_hash!,
        submissionIds: freeResults.evidence.map((evidence) => evidence.id),
      }),
      { crypto: globalThis.crypto, TextEncoder, console: { log() {} } },
    );
    expect(verifiedDraw.winner).toBe(freeResults.raffle.winner_submission_id);

    const paidId = ask({ min_responses: 1, max_responses: 4 }, true);
    const paidObserverId = `activity-${paidId}-winner`;
    const paidObserver = store.getOrCreateObserver(paidObserverId);
    store.updateObserver(paidObserver.id, { evm_address: `0x${"22".repeat(20)}` });
    expect(await submit(paidId, paidObserverId, 0, 4)).toMatchObject({ ok: true });
    await store.closeNow(paidId);

    const paidFeed = await activity({ origin });
    const paidEvents = paidFeed.events.filter((event) => event.question_id === paidId);
    expect(paidEvents.find((event) => event.type === "question_asked")).toMatchObject({
      payment_tx: PAYMENT_TX,
      payer_address: "0xactivity-agent",
    });
    const ordered = paidEvents
      .filter((event) => event.type === "payout" || event.type === "raffle_reveal" || event.type === "question_closed")
      .map((event) => event.type);
    expect(ordered).toEqual(["payout", "raffle_reveal", "question_closed"]);
    expect(paidEvents.find((event) => event.type === "payout")).toMatchObject({
      kind: "payout",
      tx: PAYOUT_TX,
      amount: 2.25,
      to_label: paidObserver.display_name,
    });
    expect(transferAusd).toHaveBeenCalledExactlyOnceWith(`0x${"22".repeat(20)}`, BigInt(2_250_000), expect.anything());

    expect(paidFeed.counters.questions).toBe(before.counters.questions + 2);
    expect(paidFeed.counters.verified_photos).toBe(before.counters.verified_photos + 4);
    expect(paidFeed.counters.unique_observers).toBe(before.counters.unique_observers + 4);
    expect(paidFeed.counters.ausd_paid).toBe(before.counters.ausd_paid + 2.25);
    expect(paidFeed.counters.ausd_bounties).toBe(before.counters.ausd_bounties + 2.5);
    expect(paidFeed.counters.onchain_txs).toBe(before.counters.onchain_txs + 2);

    const askedAt = paidEvents.find((event) => event.type === "question_asked")!.at;
    const sinceFeed = await activity({ origin, since: askedAt });
    expect(sinceFeed.events.some((event) => event.id === `question_asked:${paidId}`)).toBe(false);
    expect(sinceFeed.events.filter((event) => event.question_id === paidId).every((event) => event.at > askedAt)).toBe(
      true,
    );

    const invalidSince = await GET(new Request(`${origin}/api/activity?since=garbage`));
    expect(invalidSince.status).toBe(400);
  });
});
