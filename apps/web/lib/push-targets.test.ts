import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint, PUSH_MAX_LOCATION_AGE_MS, PUSH_MIN_INTERVAL_MS, PUSH_RADIUS_M, selectPushTargets } from "./push-targets";

const NOW = Date.parse("2026-01-15T12:00:00Z");
const Q = { lat: 37.8716, lng: -122.2536 };

const sub = (extra: Record<string, unknown> = {}) => ({
  endpoint: `https://push.test/${Math.random()}`,
  lat: Q.lat,
  lng: Q.lng,
  location_at: new Date(NOW).toISOString(),
  last_push_at: null,
  ...extra,
});

describe("selectPushTargets", () => {
  it("includes a subscriber ~1.0 km away, excludes ~2.0 km", () => {
    // ~1.0 km north / ~2.0 km north of the question.
    const near = sub({ lat: Q.lat + 0.009 });
    const far = sub({ lat: Q.lat + 0.018 });
    const out = selectPushTargets([near, far], Q, { now: NOW });
    expect(out).toEqual([near]);
  });

  it("excludes subscriptions with no location", () => {
    expect(selectPushTargets([sub({ lat: null, lng: null, location_at: null })], Q, { now: NOW })).toEqual([]);
  });

  it("excludes a location fix older than 7 days", () => {
    const stale = sub({ location_at: new Date(NOW - PUSH_MAX_LOCATION_AGE_MS - 60_000).toISOString() });
    const fresh = sub({ location_at: new Date(NOW - PUSH_MAX_LOCATION_AGE_MS + 60_000).toISOString() });
    expect(selectPushTargets([stale, fresh], Q, { now: NOW })).toEqual([fresh]);
  });

  it("excludes a push sent 1 min ago, includes one sent 4 min ago", () => {
    const recent = sub({ last_push_at: new Date(NOW - 60_000).toISOString() });
    const older = sub({ last_push_at: new Date(NOW - 4 * 60_000).toISOString() });
    expect(selectPushTargets([recent, older], Q, { now: NOW })).toEqual([older]);
    expect(PUSH_MIN_INTERVAL_MS).toBe(3 * 60_000);
    expect(PUSH_RADIUS_M).toBe(1500);
  });

  it("honors a custom radiusM", () => {
    const at2km = sub({ lat: Q.lat + 0.018 });
    expect(selectPushTargets([at2km], Q, { now: NOW })).toEqual([]);
    expect(selectPushTargets([at2km], Q, { now: NOW, radiusM: 2500 })).toEqual([at2km]);
  });
});

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/token",
    "https://sub.android.googleapis.com/path",
    "https://push.services.mozilla.com/wpush/v2/token",
    "https://notify.windows.com/w/?token",
    "https://push.apple.com/3/device/token",
  ])("allows trusted push endpoint %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true);
  });

  it.each([
    "https://169.254.169.254/",
    "https://evilfcm.googleapis.com.attacker.com/",
    "https://fcm.googleapis.com.evil.com/",
    "http://fcm.googleapis.com/",
    "https://user@fcm.googleapis.com/",
    "https://fcm.googleapis.com:8443/",
  ])("rejects untrusted push endpoint %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false);
  });
});
