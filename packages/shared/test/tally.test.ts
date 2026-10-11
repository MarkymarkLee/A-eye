import { describe, expect, it } from "vitest";
import { tally } from "../src/tally.js";

describe("tally", () => {
  it("counts and rounds percentages to one decimal", () => {
    expect(tally(["Yes", "No", "Unsure"], [0, 0, 1])).toEqual([
      { option: "Yes", count: 2, pct: 66.7 },
      { option: "No", count: 1, pct: 33.3 },
      { option: "Unsure", count: 0, pct: 0 },
    ]);
  });

  it("returns zeros with no responses and ignores out-of-range indexes", () => {
    expect(tally(["Yes", "No"], [5, -1])).toEqual([
      { option: "Yes", count: 0, pct: 0 },
      { option: "No", count: 0, pct: 0 },
    ]);
  });
});
