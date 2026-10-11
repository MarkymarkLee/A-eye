import { GEO_RULES } from "@a-eye/shared";

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export type GeoCheck =
  | { ok: true; distance_m: number }
  | { ok: false; distance_m: number; reason: string };

/** The rules from PLAN.md: accuracy cap, distance within radius + accuracy, capture time near server time. */
export function checkPresence(input: {
  question: { lat: number; lng: number; radius_m: number };
  lat: number;
  lng: number;
  accuracy_m: number;
  captured_at: string;
  now?: number;
}): GeoCheck {
  const now = input.now ?? Date.now();
  const distance = Math.round(
    distanceM(input.question.lat, input.question.lng, input.lat, input.lng),
  );
  if (input.accuracy_m > GEO_RULES.maxAccuracyM) {
    return {
      ok: false,
      distance_m: distance,
      reason: `GPS accuracy is ${Math.round(input.accuracy_m)} m. Step outside or wait for a fix under ${GEO_RULES.maxAccuracyM} m.`,
    };
  }
  const allowed = input.question.radius_m + input.accuracy_m;
  if (distance > allowed) {
    return {
      ok: false,
      distance_m: distance,
      reason: `You're ${formatDistance(distance)} away. This question needs you within ${formatDistance(input.question.radius_m)}.`,
    };
  }
  const skew = Math.abs(now - Date.parse(input.captured_at));
  if (!Number.isFinite(skew) || skew > GEO_RULES.maxClockSkewMs) {
    return {
      ok: false,
      distance_m: distance,
      reason: "That photo is too old. Take a fresh one and submit within 2 minutes.",
    };
  }
  return { ok: true, distance_m: distance };
}

export function formatDistance(m: number) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
