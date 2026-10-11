import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("A_EYE_DB_PATH", ":memory:");
afterAll(() => vi.unstubAllEnvs());

const store = await import("./store");

const ENDPOINT = "https://push.test/sub/1";
const setup = () => {
  const obs = store.getOrCreateObserver(undefined);
  return obs.id;
};

describe("push_subscriptions store", () => {
  it("stores coords rounded to 3 decimals and upserts the same endpoint", () => {
    const observerId = setup();
    const rec = store.savePushSubscription({
      observerId,
      endpoint: ENDPOINT,
      p256dh: "k1",
      auth: "a1",
      lat: 37.87164,
      lng: -122.25368,
    });
    expect(rec).toMatchObject({ lat: 37.872, lng: -122.254, p256dh: "k1", observer_id: observerId });
    expect(rec.location_at).not.toBeNull();
    expect(rec.created_at).not.toBeNull();

    const again = store.savePushSubscription({
      observerId,
      endpoint: ENDPOINT,
      p256dh: "k2",
      auth: "a2",
      lat: 37.9,
      lng: -122.3,
    });
    expect(again).toMatchObject({ p256dh: "k2", auth: "a2", lat: 37.9, lng: -122.3 });
    expect(store.pushSubscriptionsNear(37.9, -122.3, 500).filter((s) => s.endpoint === ENDPOINT)).toHaveLength(1);
  });

  it("keeps the previous location when saved without lat/lng", () => {
    const observerId = setup();
    store.savePushSubscription({
      observerId,
      endpoint: "https://push.test/sub/2",
      p256dh: "k",
      auth: "a",
      lat: 37.8716,
      lng: -122.2536,
    });
    const rec = store.savePushSubscription({ observerId, endpoint: "https://push.test/sub/2", p256dh: "k2", auth: "a2" });
    expect(rec).toMatchObject({ lat: 37.872, lng: -122.254 });
    expect(rec.location_at).not.toBeNull();
  });

  it("pushSubscriptionsNear returns near, not far or locationless", () => {
    const observerId = setup();
    store.savePushSubscription({
      observerId,
      endpoint: "https://push.test/sub/near",
      p256dh: "k",
      auth: "a",
      lat: 37.872,
      lng: -122.254,
    });
    store.savePushSubscription({
      observerId,
      endpoint: "https://push.test/sub/far",
      p256dh: "k",
      auth: "a",
      lat: 38.5,
      lng: -122.2536,
    });
    store.savePushSubscription({ observerId, endpoint: "https://push.test/sub/noloc", p256dh: "k", auth: "a" });
    const near = store.pushSubscriptionsNear(37.8716, -122.2536, 1500);
    const endpoints = near.map((s) => s.endpoint);
    expect(endpoints).toContain("https://push.test/sub/near");
    expect(endpoints).not.toContain("https://push.test/sub/far");
    expect(endpoints).not.toContain("https://push.test/sub/noloc");
  });

  it("claimPushSlot claims once per interval, then again after", () => {
    const observerId = setup();
    store.savePushSubscription({ observerId, endpoint: "https://push.test/sub/3", p256dh: "k", auth: "a" });
    const t0 = Date.parse("2026-01-15T12:00:00Z");
    expect(store.claimPushSlot("https://push.test/sub/3", t0, 180_000)).toBe(true);
    expect(store.claimPushSlot("https://push.test/sub/3", t0 + 60_000, 180_000)).toBe(false);
    expect(store.claimPushSlot("https://push.test/sub/3", t0 + 181_000, 180_000)).toBe(true);
  });

  it("deletePushSubscription removes the row", () => {
    const observerId = setup();
    store.savePushSubscription({ observerId, endpoint: "https://push.test/sub/4", p256dh: "k", auth: "a" });
    expect(store.deletePushSubscription("https://push.test/sub/4")).toBe(true);
    expect(store.deletePushSubscription("https://push.test/sub/4")).toBe(false);
  });
});
