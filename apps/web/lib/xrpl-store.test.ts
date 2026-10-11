import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./raffle", async (orig) => ({ ...(await orig<typeof import("./raffle")>()), latestBlock: async () => undefined }));
const xrpl = vi.hoisted(() => ({
  createPotEscrow: vi.fn(),
  finishEscrow: vi.fn(),
  cancelEscrow: vi.fn(),
  payoutXrp: vi.fn(),
  issueObserverCredential: vi.fn(),
}));
vi.mock("./xrpl", async (orig) => ({ ...(await orig<typeof import("./xrpl")>()), ...xrpl }));
const transferAusd = vi.fn();
const transferAusdViaFacilitator = vi.fn();
vi.mock("./chain", async (orig) => ({ ...(await orig<typeof import("./chain")>()), transferAusd, transferAusdViaFacilitator }));

vi.stubEnv("A_EYE_DB_PATH", ":memory:");
vi.stubEnv("A_EYE_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "a-eye-xrpl-")));
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const store = await import("./store");

const OWNER = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const WINNER = "rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH";
const hash = (c: string) => c.repeat(64);
const ORIGIN = "http://a-eye.test";

const ask = (extra: Record<string, unknown> = {}) =>
  store.createQuestion({
    lat: 37.8716,
    lng: -122.2536,
    radius_m: 150,
    question: "Is the Chou Hall cafe line longer than 5 people?",
    options: ["Yes", "No"],
    allow_free_text: false,
    prize_usd: 1,
    min_responses: 1,
    max_responses: 5,
    closes_in_minutes: 5,
    xrpl_escrow: true,
    ...extra,
  });

let photo = 0;
const answer = (questionId: string, observerId: string) =>
  store.addSubmission({
    question_id: questionId,
    observer_id: observerId,
    option_index: 0,
    image: { bytes: new Uint8Array([0xff, 0xd8, photo++, 7, 7]), type: "image/jpeg" },
    lat: 37.8716,
    lng: -122.2536,
    accuracy_m: 5,
    distance_m: 0,
    captured_at: new Date().toISOString(),
  });

const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe("XRPL wiring without XRPL env", () => {
  it("no-ops: no escrow, no credential, settle untouched", async () => {
    vi.stubEnv("XRPL_TREASURY_SEED", "");
    vi.stubEnv("XRPL_ISSUER_SEED", "");
    const id = ask();
    expect(await store.escrowQuestionPot(id)).toBeNull();
    const obs = store.getOrCreateObserver(undefined);
    store.updateObserver(obs.id, { xrpl_address: WINNER, payout_rail: "xrpl" });
    expect(await answer(id, obs.id)).toMatchObject({ ok: true });
    await store.closeNow(id);
    const r = (await store.getResults(id, ORIGIN))!;
    expect(r.status).toBe("settled");
    expect(r.raffle.xrpl).toBeUndefined();
    expect(store.observerCredential(obs.id)).toMatchObject({ enabled: false, credential: undefined });
    for (const fn of Object.values(xrpl)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("XRPL wiring with testnet wallets configured", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("XRPL_TREASURY_SEED", "sTreasury");
    vi.stubEnv("XRPL_ISSUER_SEED", "sIssuer");
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const fn of Object.values(xrpl)) fn.mockReset();
    transferAusd.mockReset();
    let seq = 100;
    xrpl.createPotEscrow.mockImplementation(async (amountXrp: string) => ({
      hash: hash("e"),
      explorer_url: "",
      ledger_index: 1,
      owner: OWNER,
      offer_sequence: seq++,
      amount_drops: String(Math.round(Number(amountXrp) * 1_000_000)),
    }));
    xrpl.finishEscrow.mockResolvedValue({ finish: { hash: hash("f") }, payout: null, amount_drops: "900000" });
    xrpl.cancelEscrow.mockResolvedValue({ hash: hash("c") });
    xrpl.payoutXrp.mockResolvedValue({ hash: hash("p") });
    xrpl.issueObserverCredential.mockResolvedValue({ hash: hash("a"), explorer_url: "x", ledger_index: 1, already_issued: false });
  });

  it("migrates observers and stores the payout rail and XRPL address", () => {
    const obs = store.getOrCreateObserver(undefined);
    expect(obs.payout_rail).toBe("evm");
    expect(store.updateObserver(obs.id, { xrpl_address: WINNER, payout_rail: "xrpl" })).toMatchObject({
      xrpl_address: WINNER,
      payout_rail: "xrpl",
    });
  });

  it("escrows the winner payout at creation, then EscrowFinish + XRP payout to an XRPL-rail winner", async () => {
    const id = ask();
    expect(await store.escrowQuestionPot(id)).toBe(hash("e"));
    expect(await store.escrowQuestionPot(id)).toBe(hash("e"));
    expect(xrpl.createPotEscrow).toHaveBeenCalledTimes(1);
    const [amount, finishAfter, opts] = xrpl.createPotEscrow.mock.calls[0]!;
    expect(amount).toBe("0.9");
    expect(opts.cancelAfter.getTime()).toBeGreaterThan(finishAfter.getTime());

    const obs = store.getOrCreateObserver(undefined);
    store.updateObserver(obs.id, { xrpl_address: WINNER, payout_rail: "xrpl" });
    await answer(id, obs.id);
    advance(20_000);
    await store.closeNow(id);
    expect(xrpl.finishEscrow).toHaveBeenCalledWith({ owner: OWNER, offerSequence: 100 });
    expect(xrpl.payoutXrp).toHaveBeenCalledWith(WINNER, "900000");
    const pot = (await store.getResults(id, ORIGIN))!.raffle.xrpl!;
    expect(pot).toMatchObject({ state: "finished", amount_xrp: "0.9", escrow_tx: hash("e"), finish_tx: hash("f"), payout_tx: hash("p") });
    expect(pot.payout_url).toBe(`https://testnet.xrpl.org/transactions/${hash("p")}`);
  });

  it("releases the escrow to the treasury when the winner is on the EVM rail", async () => {
    const id = ask();
    await store.escrowQuestionPot(id);
    const obs = store.getOrCreateObserver(undefined);
    await answer(id, obs.id);
    advance(20_000);
    await store.closeNow(id);
    expect(xrpl.finishEscrow).toHaveBeenCalledTimes(1);
    expect(xrpl.payoutXrp).not.toHaveBeenCalled();
    expect((await store.getResults(id, ORIGIN))!.raffle.xrpl).toMatchObject({ state: "finished", payout_tx: undefined });
  });

  it("waits for FinishAfter on an early close and retries a failed release later", async () => {
    const id = ask();
    await store.escrowQuestionPot(id);
    const obs = store.getOrCreateObserver(undefined);
    store.updateObserver(obs.id, { xrpl_address: WINNER, payout_rail: "xrpl" });
    await answer(id, obs.id);
    await store.closeNow(id);
    expect(xrpl.finishEscrow).not.toHaveBeenCalled();

    advance(20_000);
    xrpl.payoutXrp.mockRejectedValueOnce(new Error("tecUNFUNDED_PAYMENT"));
    await store.settleXrplPot(id);
    expect((await store.getResults(id, ORIGIN))!.raffle.xrpl).toMatchObject({ state: "escrowed", finish_tx: hash("f") });

    advance(10_000);
    await store.settleXrplPot(id);
    expect(xrpl.payoutXrp).toHaveBeenCalledTimes(1);
    advance(30_000);
    await store.settleXrplPot(id);
    expect(xrpl.finishEscrow).toHaveBeenCalledTimes(1);
    expect(xrpl.payoutXrp).toHaveBeenCalledTimes(2);
    expect((await store.getResults(id, ORIGIN))!.raffle.xrpl).toMatchObject({ state: "finished", payout_tx: hash("p") });
  });

  it("cancels (refunds) the escrow once an expired question passes CancelAfter", async () => {
    const id = ask({ min_responses: 2 });
    await store.escrowQuestionPot(id);
    await store.closeNow(id);
    await store.settleXrplPot(id);
    expect(xrpl.cancelEscrow).not.toHaveBeenCalled();
    advance(8 * 60_000);
    await store.settleXrplPot(id);
    expect(xrpl.cancelEscrow).toHaveBeenCalledWith({ owner: OWNER, offerSequence: 100 });
    const r = (await store.getResults(id, ORIGIN))!;
    expect(r.status).toBe("expired");
    expect(r.raffle.xrpl).toMatchObject({ state: "canceled", cancel_tx: hash("c") });
  });

  it("issues the Verified Observer credential once, after 3 accepted answers with an XRPL address", async () => {
    const obs = store.getOrCreateObserver(undefined);
    for (let i = 0; i < 3; i++) await answer(ask({ xrpl_escrow: false }), obs.id);
    await store.maybeIssueObserverCredential(obs.id);
    expect(xrpl.issueObserverCredential).not.toHaveBeenCalled();
    expect(store.observerCredential(obs.id)).toMatchObject({ enabled: true, accepted: 3, credential: undefined });

    store.updateObserver(obs.id, { xrpl_address: WINNER });
    await store.maybeIssueObserverCredential(obs.id);
    await store.maybeIssueObserverCredential(obs.id);
    expect(xrpl.issueObserverCredential).toHaveBeenCalledExactlyOnceWith(WINNER);
    expect(store.observerCredential(obs.id).credential).toMatchObject({
      subject: WINNER,
      state: "issued",
      tx: hash("a"),
      url: `https://testnet.xrpl.org/transactions/${hash("a")}`,
    });
  });
});
