import { MAX_CAPTURE_SKEW_MS, MAX_GPS_ACCURACY_M } from "./constants.js";

const EARTH_RADIUS_M = 6_371_008.8;

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type GeoRejectReason = "low_accuracy" | "too_far" | "stale_capture";

export type GeoCheckResult =
  | { ok: true; distance_m: number }
  | { ok: false; reason: GeoRejectReason; message: string; distance_m: number };

export interface GeoCheckInput {
  question: LatLng & { radius_m: number };
  submission: LatLng & { accuracy_m: number; captured_at: string | Date };
  now?: Date;
}

export function checkSubmissionLocation({ question, submission, now = new Date() }: GeoCheckInput): GeoCheckResult {
  const distance_m = Math.round(haversineMeters(question, submission));

  if (submission.accuracy_m > MAX_GPS_ACCURACY_M) {
    return {
      ok: false,
      reason: "low_accuracy",
      distance_m,
      message: `Your GPS accuracy is ±${Math.round(submission.accuracy_m)} m; it needs to be ±${MAX_GPS_ACCURACY_M} m or better. Try moving outdoors.`,
    };
  }

  const allowed = question.radius_m + submission.accuracy_m;
  if (distance_m > allowed) {
    return {
      ok: false,
      reason: "too_far",
      distance_m,
      message: `You're ${distance_m} m away; you need to be within ${Math.round(allowed)} m.`,
    };
  }

  const capturedAt = new Date(submission.captured_at).getTime();
  if (!Number.isFinite(capturedAt) || Math.abs(capturedAt - now.getTime()) > MAX_CAPTURE_SKEW_MS) {
    return {
      ok: false,
      reason: "stale_capture",
      distance_m,
      message: "The photo must be taken within the last 2 minutes.",
    };
  }

  return { ok: true, distance_m };
}
