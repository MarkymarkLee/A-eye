import { describe, expect, it } from "vitest";
import { checkSubmissionLocation, haversineMeters } from "../src/geo.js";

const CHOU_HALL = { lat: 37.87128, lng: -122.25369 };
const now = new Date("2026-10-11T20:00:00Z");

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineMeters(CHOU_HALL, CHOU_HALL)).toBe(0);
  });

  it("matches a known distance (~1 deg latitude ≈ 111.2 km)", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });
});

describe("checkSubmissionLocation", () => {
  const question = { ...CHOU_HALL, radius_m: 150 };

  it("accepts a nearby, accurate, fresh capture", () => {
    const r = checkSubmissionLocation({
      question,
      submission: { lat: 37.8716, lng: -122.2537, accuracy_m: 10, captured_at: now.toISOString() },
      now,
    });
    expect(r.ok).toBe(true);
    expect(r.distance_m).toBeLessThan(50);
  });

  it("rejects low GPS accuracy", () => {
    const r = checkSubmissionLocation({
      question,
      submission: { ...CHOU_HALL, accuracy_m: 120, captured_at: now.toISOString() },
      now,
    });
    expect(r).toMatchObject({ ok: false, reason: "low_accuracy" });
  });

  it("rejects submissions outside radius + accuracy with the distance in the message", () => {
    const r = checkSubmissionLocation({
      question,
      submission: { lat: 37.8751, lng: -122.2537, accuracy_m: 10, captured_at: now.toISOString() },
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("too_far");
      expect(r.message).toContain(`${r.distance_m} m away`);
    }
  });

  it("allows the accuracy margin on top of the radius", () => {
    const edge = { lat: CHOU_HALL.lat + 160 / 111_195, lng: CHOU_HALL.lng };
    const tight = checkSubmissionLocation({ question, submission: { ...edge, accuracy_m: 5, captured_at: now.toISOString() }, now });
    const loose = checkSubmissionLocation({ question, submission: { ...edge, accuracy_m: 20, captured_at: now.toISOString() }, now });
    expect(tight.ok).toBe(false);
    expect(loose.ok).toBe(true);
  });

  it("rejects captures older than 2 minutes", () => {
    const r = checkSubmissionLocation({
      question,
      submission: { ...CHOU_HALL, accuracy_m: 10, captured_at: new Date(now.getTime() - 3 * 60_000).toISOString() },
      now,
    });
    expect(r).toMatchObject({ ok: false, reason: "stale_capture" });
  });
});
