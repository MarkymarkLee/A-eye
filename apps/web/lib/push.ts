import "server-only";
import webpush from "web-push";
import type { CreateQuestionInput } from "@a-eye/shared";
import {
  claimPushSlot,
  deletePushSubscription,
  pushSubscriptionsNear,
} from "./store";
import { PUSH_MAX_LOCATION_AGE_MS, PUSH_RADIUS_M, selectPushTargets } from "./push-targets";

export function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

const minIntervalMs = () => Math.max(0, Number(process.env.PUSH_MIN_INTERVAL_SECONDS ?? 180)) * 1000;

type Send = typeof webpush.sendNotification;

/** Fan-out a new question to nearby subscribed observers. Never throws; safe to fire-and-forget. */
export async function notifyNearbyQuestion(
  q: { id: string; prompt: string; prize_usd: number; lat: number; lng: number; closes_in_minutes: number },
  deps: { send: Send; now: () => number } = { send: webpush.sendNotification, now: Date.now },
): Promise<{ sent: number; failed: number }> {
  const cfg = pushConfig();
  if (!cfg) return { sent: 0, failed: 0 };
  try {
    const now = deps.now();
    const candidates = selectPushTargets(pushSubscriptionsNear(q.lat, q.lng, PUSH_RADIUS_M), q, {
      now,
      minIntervalMs: minIntervalMs(),
      maxLocationAgeMs: PUSH_MAX_LOCATION_AGE_MS,
    });
    const payload = JSON.stringify({
      title: "New question near you",
      body: `${q.prompt} (${q.prize_usd} AUSD prize)`,
      url: `/q/${q.id}/answer`,
      tag: `q-${q.id}`,
    });
    const results = await Promise.allSettled(
      candidates.map(async (sub) => {
        // Atomic claim first so a concurrent question can't double-send within the interval.
        if (!claimPushSlot(sub.endpoint, now, minIntervalMs())) return;
        await deps.send(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          {
            vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
            TTL: Math.min(q.closes_in_minutes * 60, 3600),
            urgency: "high",
          },
        );
      }),
    );
    let sent = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === "fulfilled") {
        sent += 1;
        continue;
      }
      failed += 1;
      const statusCode = (r.reason as { statusCode?: number })?.statusCode;
      const endpoint = candidates[results.indexOf(r)]?.endpoint;
      if (endpoint && (statusCode === 404 || statusCode === 410)) deletePushSubscription(endpoint);
    }
    return { sent, failed };
  } catch (err) {
    console.warn("[push] notifyNearbyQuestion failed:", err);
    return { sent: 0, failed: 0 };
  }
}

export function startNearbyPush(id: string, input: CreateQuestionInput) {
  void notifyNearbyQuestion({
    id,
    prompt: input.question,
    prize_usd: input.prize_usd,
    lat: input.lat,
    lng: input.lng,
    closes_in_minutes: input.closes_in_minutes,
  }).catch(console.warn);
}
