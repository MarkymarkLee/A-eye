import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("A_EYE_DB_PATH", ":memory:");
afterAll(() => vi.unstubAllEnvs());

const store = await import("./store");
const push = await import("./push");

const Q = {
  id: "qtest1",
  prompt: "Is the fountain on?",
  prize_usd: 2.5,
  lat: 37.8716,
  lng: -122.2536,
  closes_in_minutes: 60,
};

const vapid = () => {
  vi.stubEnv("VAPID_PUBLIC_KEY", "BPubKey");
  vi.stubEnv("VAPID_PRIVATE_KEY", "PrivKey");
  vi.stubEnv("VAPID_SUBJECT", "https://a-eye.test");
};
const clearVapid = () => {
  vi.stubEnv("VAPID_PUBLIC_KEY", "");
  vi.stubEnv("VAPID_PRIVATE_KEY", "");
  vi.stubEnv("VAPID_SUBJECT", "");
};

const addSub = (endpoint: string, lat = 37.872, lng = -122.254) => {
  const obs = store.getOrCreateObserver(undefined);
  return store.savePushSubscription({ observerId: obs.id, endpoint, p256dh: "k", auth: "a", lat, lng });
};

describe("notifyNearbyQuestion", () => {
  beforeEach(() => {
    for (const s of store.pushSubscriptionsNear(0, 0, 40_000_000)) store.deletePushSubscription(s.endpoint);
  });

  it("is a no-op when VAPID env is unset", async () => {
    clearVapid();
    const send = vi.fn();
    const res = await push.notifyNearbyQuestion(Q, { send, now: Date.now });
    expect(res).toEqual({ sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends only to nearby subscribers with the expected payload, and rate-limits repeats", async () => {
    vapid();
    const near = addSub("https://push.test/near");
    addSub("https://push.test/far", 38.5, -122.2536);
    const send = vi.fn().mockResolvedValue({});
    const res = await push.notifyNearbyQuestion(Q, { send, now: Date.now });
    expect(res).toEqual({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    const [subscription, payload, options] = send.mock.calls[0]!;
    expect(subscription.endpoint).toBe(near.endpoint);
    expect(subscription.keys).toEqual({ p256dh: "k", auth: "a" });
    expect(JSON.parse(payload)).toEqual({
      title: "New question near you",
      body: "Is the fountain on? (2.5 AUSD prize)",
      url: "/q/qtest1/answer",
      tag: "q-qtest1",
    });
    expect(options).toMatchObject({
      TTL: 3600,
      urgency: "high",
      vapidDetails: { subject: "https://a-eye.test", publicKey: "BPubKey", privateKey: "PrivKey" },
    });

    // Second question immediately after: the slot is claimed, nothing is sent.
    const res2 = await push.notifyNearbyQuestion({ ...Q, id: "qtest2" }, { send, now: Date.now });
    expect(res2).toEqual({ sent: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("deletes the subscription on a 410 from the push service", async () => {
    vapid();
    const gone = addSub("https://push.test/gone");
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    const res = await push.notifyNearbyQuestion(Q, { send, now: Date.now });
    expect(res).toEqual({ sent: 0, failed: 1 });
    expect(store.pushSubscriptionsNear(37.8716, -122.2536, 1500).map((s) => s.endpoint)).not.toContain(gone.endpoint);
  });
});
