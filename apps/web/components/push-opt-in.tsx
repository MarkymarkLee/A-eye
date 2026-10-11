"use client";
import { useEffect, useRef, useState } from "react";
import { BellRinging, BellSlash } from "@phosphor-icons/react";
import { registerServiceWorker } from "@/lib/sw-client";

const LOC_KEY = "aeye_push_loc";

type State = "loading" | "hidden" | "ios-hint" | "idle" | "denied" | "subscribed";

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const supported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Silent location read: only when the geolocation permission is already granted. */
async function geolocationIfGranted(): Promise<{ lat: number; lng: number } | undefined> {
  try {
    const perm = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (perm && perm.state !== "granted") return undefined;
    return await new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(undefined),
        { timeout: 8000 },
      ),
    );
  } catch {
    return undefined;
  }
}

/** Prompting location read for a user gesture. */
function geolocationPrompting(): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(undefined),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    ),
  );
}

/** Opt-in row for "new question near you" web push alerts. */
export function PushOptIn({ fix }: { fix?: { lat: number; lng: number } }) {
  const [state, setState] = useState<State>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState(1.5);
  const [hasLocation, setHasLocation] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const subscription = useRef<PushSubscription | null>(null);
  const fixRef = useRef(fix);
  fixRef.current = fix;
  // Stable dependency: the ~110 m-rounded fix, not a new object every GPS tick.
  const locKey = fix ? `${round3(fix.lat)},${round3(fix.lng)}` : null;

  const postSubscription = (sub: PushSubscription, loc?: { lat: number; lng: number }) =>
    fetch("/api/push/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), ...loc }),
    });

  // One-time init: capability check, server config, existing subscription.
  useEffect(() => {
    let alive = true;
    if (!supported()) {
      setState(isIOS() && !isStandalone() ? "ios-hint" : "hidden");
      return;
    }
    (async () => {
      const cfg = (await fetch("/api/push", { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as
        | { enabled: boolean; public_key: string | null; radius_m: number }
        | null;
      if (!alive) return;
      if (!cfg?.enabled || !cfg.public_key) {
        setState("hidden");
        return;
      }
      setPublicKey(cfg.public_key);
      setRadiusKm(cfg.radius_m / 1000);
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      const sub = (await reg?.pushManager.getSubscription()) ?? null;
      if (!alive) return;
      subscription.current = sub;
      setState(sub ? "subscribed" : "idle");
    })();
    return () => {
      alive = false;
    };
  }, []);

  // While subscribed, refresh the coarse server-side fix only when it moved (~110 m).
  useEffect(() => {
    if (state !== "subscribed" || !subscription.current) return;
    let alive = true;
    (async () => {
      const loc = fixRef.current ?? (await geolocationIfGranted());
      if (!alive || !loc) return;
      const key = `${round3(loc.lat)},${round3(loc.lng)}`;
      if (localStorage.getItem(LOC_KEY) !== key) {
        const res = await postSubscription(subscription.current!, loc).catch(() => null);
        if (res?.ok) localStorage.setItem(LOC_KEY, key);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, locKey]);

  const subscribe = async () => {
    setBusy(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm === "denied") {
        setState("denied");
        return;
      }
      await registerServiceWorker();
      // A freshly registered worker isn't active yet; wait for it before subscribing.
      const ready = await navigator.serviceWorker.ready;
      const sub = await ready.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey!),
      });
      const loc = fixRef.current ?? (await geolocationPrompting());
      const res = await postSubscription(sub, loc);
      if (!res.ok) throw new Error(`subscribe failed: ${res.status}`);
      subscription.current = sub;
      setHasLocation(!!loc);
      if (loc) localStorage.setItem(LOC_KEY, `${round3(loc.lat)},${round3(loc.lng)}`);
      setState("subscribed");
    } catch {
      setError("Couldn't turn on alerts. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const unsubscribe = async () => {
    setBusy(true);
    setError(null);
    try {
      const endpoint = subscription.current?.endpoint;
      await subscription.current?.unsubscribe().catch(() => {});
      if (endpoint) {
        await fetch("/api/push/subscription", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
      subscription.current = null;
      localStorage.removeItem(LOC_KEY);
      setState("idle");
    } finally {
      setBusy(false);
    }
  };

  if (state === "hidden" || state === "loading") return null;
  if (state === "ios-hint") {
    return (
      <p className="mt-4 flex items-start gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[13px] leading-snug text-muted">
        <BellRinging size={18} weight="bold" className="mt-px shrink-0" />
        Add A-eye to your Home Screen to get alerts
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[13px] leading-snug text-muted">
      {state === "subscribed" ? (
        <>
          <BellRinging size={18} weight="bold" className="shrink-0 text-ok" />
          <span className="flex-1">
            {hasLocation
              ? `Alerts on for new questions within ${radiusKm} km`
              : "Alerts on. Share your location to hear about questions near you."}
          </span>
          <button type="button" onClick={unsubscribe} disabled={busy} className="btn btn-ghost px-2 py-1 text-[13px]">
            <BellSlash size={14} weight="bold" /> Turn off
          </button>
        </>
      ) : state === "denied" ? (
        <>
          <BellSlash size={18} weight="bold" className="shrink-0" />
          <span className="flex-1">Notifications are blocked for this site in browser settings.</span>
        </>
      ) : (
        <button type="button" onClick={subscribe} disabled={busy} className="btn btn-ghost px-2 py-1 text-[13px]">
          <BellRinging size={16} weight="bold" /> {busy ? "Turning on…" : "Alert me to questions nearby"}
        </button>
      )}
      {error && <span className="w-full text-bad">{error}</span>}
    </div>
  );
}
