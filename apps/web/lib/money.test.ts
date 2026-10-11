import { describe, expect, it } from "vitest";
import { formatAmount, roundAmount } from "./money";

describe("formatAmount", () => {
  it("shows exact amounts with trailing zeros trimmed", () => {
    expect(formatAmount(0.045)).toBe("0.045");
    expect(formatAmount(0.05 * 0.9)).toBe("0.045");
    expect(formatAmount(2)).toBe("2");
    expect(formatAmount(1.5)).toBe("1.5");
    expect(formatAmount(0.000001)).toBe("0.000001");
    expect(formatAmount(0.1 + 0.2)).toBe("0.3");
  });
  it("is safe for missing values", () => {
    expect(formatAmount(undefined)).toBe("0");
    expect(formatAmount(Number.NaN)).toBe("0");
    expect(formatAmount(-0.0000001)).toBe("0");
  });
});

describe("roundAmount", () => {
  it("keeps 6 decimals", () => {
    expect(roundAmount(0.045)).toBe(0.045);
    expect(roundAmount(0.1 + 0.2)).toBe(0.3);
  });
});
