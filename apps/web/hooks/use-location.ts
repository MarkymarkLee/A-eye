"use client";
import { useEffect, useState } from "react";

export type Fix = { lat: number; lng: number; accuracy: number; at: number };
export type LocationState =
  | { status: "pending" }
  | { status: "unsupported" }
  | { status: "denied"; message: string }
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
        setState({
          status: "denied",
          message:
            err.code === err.PERMISSION_DENIED
              ? "Location is off for this site. Turn it on in your browser settings to answer."
              : "Couldn't get a GPS fix yet. Try stepping outside.",
        }),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return state;
}
