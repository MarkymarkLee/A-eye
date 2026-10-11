"use client";
import { useEffect, useState } from "react";

export type Fix = { lat: number; lng: number; accuracy: number; at: number };
export type LocationState =
  | { status: "pending" }
  | { status: "unsupported" }
  | { status: "denied"; reason: "blocked" | "unavailable"; message: string }
  | { status: "ok"; fix: Fix };

/** Live GPS via watchPosition. High accuracy, because answers are checked against a radius. */
export function useLocation(enabled = true): LocationState {
  const [state, setState] = useState<LocationState>({ status: "pending" });
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "unsupported" });
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setState({
          status: "ok",
          fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp },
        }),
      (err) =>
        setState((prev) =>
          prev.status === "ok" && err.code !== err.PERMISSION_DENIED
            ? prev
            : err.code === err.PERMISSION_DENIED
              ? { status: "denied", reason: "blocked", message: "Location is turned off for this site." }
              : { status: "denied", reason: "unavailable", message: "We can’t find you yet. Step outside or near a window." },
        ),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return state;
}
