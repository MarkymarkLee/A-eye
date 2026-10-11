import { distanceM } from "./geo";

export const PUSH_RADIUS_M = 1500;
export const PUSH_MIN_INTERVAL_MS = 3 * 60_000;
export const PUSH_MAX_LOCATION_AGE_MS = 7 * 24 * 3600_000;

const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
];

export function isAllowedPushEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return false;
    const host = parsed.hostname.toLowerCase();
    return PUSH_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/**
 * Which subscriptions should hear about a new question at `q`: close enough,
 * with a fresh enough location, and not notified too recently. Pure — the SQL
 * bounding-box prefilter lives in store.pushSubscriptionsNear.
 */
export function selectPushTargets<
  T extends { lat: number | null; lng: number | null; location_at: string | null; last_push_at: string | null },
>(
  subs: T[],
  q: { lat: number; lng: number },
  opts: { now: number; radiusM?: number; minIntervalMs?: number; maxLocationAgeMs?: number },
): T[] {
  const radius = opts.radiusM ?? PUSH_RADIUS_M;
  const minInterval = opts.minIntervalMs ?? PUSH_MIN_INTERVAL_MS;
  const maxAge = opts.maxLocationAgeMs ?? PUSH_MAX_LOCATION_AGE_MS;
  return subs.filter((s) => {
    if (s.lat === null || s.lng === null) return false;
    if (distanceM(q.lat, q.lng, s.lat, s.lng) > radius) return false;
    if (s.location_at === null || opts.now - Date.parse(s.location_at) > maxAge) return false;
    if (s.last_push_at !== null && opts.now - Date.parse(s.last_push_at) < minInterval) return false;
    return true;
  });
}
