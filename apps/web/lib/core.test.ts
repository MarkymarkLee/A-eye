import { describe, expect, it } from "vitest";
import { checkPresence, distanceM } from "./geo";
import { drawWinner, sha256Hex } from "./raffle";
import { tally } from "./tally";

const q = { lat: 37.86967, lng: -122.25913, radius_m: 150 };
const now = Date.parse("2026-10-11T20:00:00Z");

describe("geo", () => {
  it("measures short distances", () => {
    const d = distanceM(37.86967, -122.25913, 37.87057, -122.25913);
    expect(d).toBeGreaterThan(99);
    expect(d).toBeLessThan(101);
  });
  it("accepts someone in range", () => {
    expect(checkPresence({ question: q, lat: 37.8697, lng: -122.2592, accuracy_m: 10, captured_at: new Date(now).toISOString(), now }).ok).toBe(true);
  });
  it("rejects poor accuracy, distance and stale photos", () => {
    const base = { question: q, lat: 37.8697, lng: -122.2592, captured_at: new Date(now).toISOString(), now };
    expect(checkPresence({ ...base, accuracy_m: 120 }).ok).toBe(false);
    expect(checkPresence({ ...base, accuracy_m: 10, lat: 37.874 }).ok).toBe(false);
    expect(checkPresence({ ...base, accuracy_m: 10, captured_at: new Date(now - 3 * 60_000).toISOString() }).ok).toBe(false);
  });
});

describe("tally", () => {
  it("sums to 100 with largest remainder", () => {
    const rows = tally(["a", "b", "c"], [0, 1, 2]);
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBe(100);
  });
  it("handles zero answers", () => {
    expect(tally(["a", "b"], []).every((r) => r.pct === 0)).toBe(true);
  });
});

describe("raffle", () => {
  it("is deterministic and order independent", () => {
    const a = drawWinner("seed", "0xabc", "q1", ["s3", "s1", "s2"]);
    const b = drawWinner("seed", "0xabc", "q1", ["s1", "s2", "s3"]);
    expect(a).toEqual(b);
    expect(sha256Hex("seed")).toHaveLength(64);
  });
});
