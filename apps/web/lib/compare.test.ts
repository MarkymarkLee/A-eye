import { describe, expect, it } from "vitest";
import { humanLeader, marketVsHumans, webVsHumans, yesOptionIndex } from "./compare";
import type { TallyRow } from "@a-eye/shared";

const tally: TallyRow[] = [
  { option: "Yes", count: 3, pct: 60 },
  { option: "No", count: 2, pct: 40 },
];

describe("comparison helpers", () => {
  it("returns the first row in a leader tie and no leader for zero responses", () => {
    expect(humanLeader([{ option: "A", count: 2, pct: 50 }, { option: "B", count: 2, pct: 50 }])).toEqual({
      option: "A",
      count: 2,
      pct: 50,
    });
    expect(humanLeader([{ option: "A", count: 0, pct: 0 }, { option: "B", count: 0, pct: 0 }])).toBeUndefined();
    expect(humanLeader([])).toBeUndefined();
  });

  it("compares baseline option indices with the human leader", () => {
    expect(webVsHumans({ answer: "yes", source: "web", option_index: 0 }, tally)).toEqual({
      web: "yes",
      source: "web",
      web_option: "Yes",
      humans: tally[0],
      agree: true,
    });
    expect(webVsHumans({ answer: "no", source: "web", option_index: 1 }, tally)?.agree).toBe(false);
    expect(webVsHumans({ answer: "unclear", source: "web" }, tally)).toMatchObject({
      web: "unclear",
      source: "web",
      humans: tally[0],
    });
    expect(webVsHumans({ answer: "yes", source: "web", option_index: 0 }, [])?.agree).toBeUndefined();
    expect(webVsHumans(undefined, tally)).toBeUndefined();
  });

  it("prefers an in-range market yes index and otherwise finds the first yes option", () => {
    expect(yesOptionIndex(["No", "  YES, probably"], { provider: "market", yes_option_index: 0 })).toBe(0);
    expect(yesOptionIndex(["No", "  YES, probably"])).toBe(1);
    expect(yesOptionIndex(["Up", "Down"], { provider: "market", yes_option_index: 4 })).toBe(0);
  });

  it("compares market odds with human percentages and handles absent responses", () => {
    expect(marketVsHumans({ provider: "Gemini", implied_yes: 0.62 }, ["Yes", "No"], tally)).toEqual({
      provider: "Gemini",
      market_pct: 62,
      humans_pct: 60,
      yes_option: "Yes",
      gap: -2,
    });
    expect(marketVsHumans({ provider: "Gemini", implied_yes: null }, ["Yes", "No"], tally)).toBeUndefined();
    expect(marketVsHumans({ provider: "Gemini" }, ["Yes", "No"], tally)).toBeUndefined();
    expect(marketVsHumans({ provider: "Gemini", implied_yes: 0.5 }, ["Yes", "No"], [])).toMatchObject({
      humans_pct: null,
      gap: null,
    });
  });
});
