import { describe, expect, it } from "vitest";
import { AskQuestionInput, SubmissionMeta } from "../src/schemas.js";
import { fromBaseUnits, toBaseUnits, winnerPayout } from "../src/money.js";

describe("AskQuestionInput", () => {
  it("applies defaults", () => {
    const q = AskQuestionInput.parse({ lat: 37.87, lng: -122.25, question: "Is there a line?", options: ["Yes", "No"] });
    expect(q).toMatchObject({ radius_m: 150, prize_usd: 1, min_responses: 3, max_responses: 20, closes_in_minutes: 30 });
  });

  it("rejects bad option counts, duplicates and min > max", () => {
    const base = { lat: 0, lng: 0, question: "Open?" };
    expect(AskQuestionInput.safeParse({ ...base, options: ["Yes"] }).success).toBe(false);
    expect(AskQuestionInput.safeParse({ ...base, options: ["Yes", "yes"] }).success).toBe(false);
    expect(AskQuestionInput.safeParse({ ...base, options: ["Yes", "No"], min_responses: 5, max_responses: 2 }).success).toBe(false);
  });
});

describe("SubmissionMeta", () => {
  it("requires an ISO timestamp", () => {
    const ok = { option_index: 0, lat: 1, lng: 1, accuracy_m: 5, captured_at: "2026-10-11T20:00:00.000Z" };
    expect(SubmissionMeta.safeParse(ok).success).toBe(true);
    expect(SubmissionMeta.safeParse({ ...ok, captured_at: "yesterday" }).success).toBe(false);
  });
});

describe("money", () => {
  it("converts AUSD amounts to 6-decimal base units and back", () => {
    expect(toBaseUnits("1")).toBe(1_000_000n);
    expect(toBaseUnits(0.25)).toBe(250_000n);
    expect(fromBaseUnits(1_500_000n)).toBe("1.5");
    expect(() => toBaseUnits("1.0000001")).toThrow();
  });

  it("takes a 10% platform fee from the winner payout", () => {
    expect(winnerPayout(1_000_000n)).toBe(900_000n);
  });
});
