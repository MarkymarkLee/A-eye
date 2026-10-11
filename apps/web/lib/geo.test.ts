import { describe, expect, it } from "vitest";
import { checkPresence, lngBoxSql } from "./geo";
import { parseSubmissionFields } from "./submission-form";

const question = { lat: 0, lng: 0, radius_m: 100 };
const base = { question, lat: 0, lng: 0, accuracy_m: 5, captured_at: new Date().toISOString() };

describe("checkPresence", () => {
  it("accepts distance exactly at radius + accuracy and rejects +2 m beyond", () => {
    const within = { ...base, lat: 105 / 111_320 }; // ~105 m north
    const inside = checkPresence(within);
    expect(inside).toMatchObject({ ok: true });
    expect(inside.distance_m).toBeLessThanOrEqual(105);
    const beyond = { ...base, lat: 107 / 111_320 };
    const outside = checkPresence(beyond);
    expect(outside.ok).toBe(false);
    expect(outside.distance_m).toBeGreaterThan(105);
  });

  it("caps GPS accuracy at 75 m", () => {
    expect(checkPresence({ ...base, accuracy_m: 75 }).ok).toBe(true);
    expect(checkPresence({ ...base, accuracy_m: 75.1 }).ok).toBe(false);
  });

  it("enforces the capture-time window in both directions", () => {
    const now = Date.now();
    const at = (offsetMs: number) => ({ ...base, captured_at: new Date(now + offsetMs).toISOString() });
    expect(checkPresence({ ...at(-119_000), now }).ok).toBe(true);
    const old = checkPresence({ ...at(-121_000), now });
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.reason).toContain("too old");
    expect(checkPresence({ ...at(60_000), now }).ok).toBe(true);
    const future = checkPresence({ ...at(121_000), now });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.reason).toContain("clock is ahead");
    expect(checkPresence({ ...base, captured_at: "not a date", now }).ok).toBe(false);
  });

  it("measures across the antimeridian and near the poles", () => {
    // ~111 m apart across ±180.
    const anti = checkPresence({
      question: { lat: 0, lng: 179.9995, radius_m: 150 },
      lat: 0,
      lng: -179.9995,
      accuracy_m: 5,
      captured_at: new Date().toISOString(),
    });
    expect(anti).toMatchObject({ ok: true });
    // ~22 m apart at 89.9999°N on opposite meridians.
    const pole = checkPresence({
      question: { lat: 89.9999, lng: 0, radius_m: 150 },
      lat: 89.9999,
      lng: 180,
      accuracy_m: 5,
      captured_at: new Date().toISOString(),
    });
    expect(pole).toMatchObject({ ok: true });
  });
});

describe("lngBoxSql", () => {
  it("covers plain, wrapped, and whole-range cases", () => {
    expect(lngBoxSql(0, 10)).toEqual({ sql: "lng between ? and ?", params: [-10, 10] });
    expect(lngBoxSql(179, 10)).toEqual({ sql: "(lng >= ? or lng <= ?)", params: [169, -171] });
    expect(lngBoxSql(-179, 10)).toEqual({ sql: "(lng >= ? or lng <= ?)", params: [171, -169] });
    expect(lngBoxSql(0, 180)).toEqual({ sql: "1 = 1", params: [] });
    expect(lngBoxSql(0, Number.POSITIVE_INFINITY)).toEqual({ sql: "1 = 1", params: [] });
  });
});

describe("parseSubmissionFields", () => {
  const valid = {
    option_index: "0",
    lat: "37.8716",
    lng: "-122.2536",
    accuracy_m: "5",
    captured_at: new Date().toISOString(),
  };
  const form = (entries: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(entries)) data.append(k, v);
    return data;
  };

  it("rejects empty lat/lng/accuracy instead of coercing to 0", () => {
    expect(parseSubmissionFields(form({ ...valid, lat: "" })).success).toBe(false);
    expect(parseSubmissionFields(form({ ...valid, lat: "  " })).success).toBe(false);
    expect(parseSubmissionFields(form({ ...valid, lng: "" })).success).toBe(false);
    expect(parseSubmissionFields(form({ ...valid, accuracy_m: "" })).success).toBe(false);
  });

  it("parses a fully populated form", () => {
    const parsed = parseSubmissionFields(form(valid));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.lat).toBeCloseTo(37.8716);
      expect(parsed.data.option_index).toBe(0);
    }
  });
});
