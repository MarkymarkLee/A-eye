import { describe, expect, it } from "vitest";
import { fromBaseUnits, toBaseUnits, winnerPayout } from "../src/money";

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
