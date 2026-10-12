import { describe, expect, it } from "vitest";
import { formatRaffle, formatSummary, parseResults } from "../src/results.js";

const markShape = JSON.stringify({
  id: "q1",
  prompt: "Is it warm?",
  status: "settled",
  responses: 9,
  tally: [
    { option: "Yes", count: 7, pct: 77.8 },
    { option: "No", count: 2, pct: 22.2 },
  ],
  evidence: [],
  gallery_url: "http://x/q/q1",
  raffle: {
    seed_commit: "abc",
    seed_reveal: "def",
    winner_observer: "observer-1",
    winner_submission_id: "s_1",
    prize_amount: 0.9,
    currency: "AUSD",
    payout_tx: "0xtx",
  },
});

const oldShape = JSON.stringify({
  question_id: "q2",
  status: "open",
  responses: 0,
  tally: [],
  evidence: [],
  gallery_url: "http://x/q/q2",
  raffle: { seed_commit: "abc", winner: null },
});

describe("parseResults/formatSummary/formatRaffle", () => {
  it("formats Mark's shape", () => {
    const r = parseResults(markShape)!;
    expect(r.id).toBe("q1");
    expect(formatSummary(r)).toBe("78% yes (9 humans), gallery: http://x/q/q1");
    expect(formatRaffle(r)).toContain("Raffle winner: observer-1");
    expect(formatRaffle(r)).toContain("0xtx");
    expect(formatRaffle(r)).toContain("seed reveal def");
  });

  it("accepts the old question_id contract", () => {
    const r = parseResults(oldShape)!;
    expect(r.id).toBe("q2");
    expect(formatSummary(r)).toBe("No answers yet (0 humans), gallery: http://x/q/q2");
    expect(formatRaffle(r)).toBe("Raffle: not drawn yet (status open)");
  });

  it("handles zero responses", () => {
    const r = parseResults(
      JSON.stringify({ id: "q3", status: "open", responses: 0, tally: [{ option: "Yes", count: 0, pct: 0 }] }),
    )!;
    expect(formatSummary(r)).toBe("No answers yet (0 humans)");
  });

  it("returns undefined for non-JSON", () => {
    expect(parseResults("nope")).toBeUndefined();
  });
});
