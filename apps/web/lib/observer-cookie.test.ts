import { describe, expect, it } from "vitest";
import { isLegacyObserverId, signObserverId, verifyObserverCookie } from "./observer-cookie";

const secret = "a sufficiently long observer cookie secret";

describe("observer cookie signatures", () => {
  it("round-trips signed observer ids", () => {
    const value = signObserverId("observer-1", secret);
    expect(verifyObserverCookie(value, secret)).toBe("observer-1");
  });

  it("rejects tampered ids, signatures, wrong secrets, and malformed values", () => {
    const value = signObserverId("observer-1", secret);
    const [, signature] = value.split(".");
    expect(verifyObserverCookie(`observer-2.${signature}`, secret)).toBeUndefined();
    expect(verifyObserverCookie(`observer-1.${signature!.slice(0, -1)}x`, secret)).toBeUndefined();
    expect(verifyObserverCookie(value, `${secret}!`)).toBeUndefined();
    for (const bad of ["no-dot", "a/b.sig", "a..sig", `${"a".repeat(65)}.sig`]) {
      expect(verifyObserverCookie(bad, secret)).toBeUndefined();
    }
  });

  it("detects only canonical UUID legacy observer ids", () => {
    expect(isLegacyObserverId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isLegacyObserverId("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
    expect(isLegacyObserverId("seed-obs-0")).toBe(false);
    expect(isLegacyObserverId("not-a-uuid")).toBe(false);
  });
});
