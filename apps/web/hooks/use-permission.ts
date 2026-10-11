"use client";
import { useEffect, useState } from "react";

export type PermissionStatus = "unknown" | "prompt" | "granted" | "denied";

/** Reads (and follows) the browser permission state so we can explain before the browser asks. */
export function usePermission(name: "geolocation" | "camera"): PermissionStatus {
  const [state, setState] = useState<PermissionStatus>("unknown");
  useEffect(() => {
    let status: PermissionStatus_ | null = null;
    const update = () => status && setState(status.state as PermissionStatus);
    navigator.permissions
      ?.query({ name: name as PermissionName })
      .then((s) => {
        status = s;
        update();
        s.addEventListener("change", update);
      })
      .catch(() => setState("prompt"));
    if (!navigator.permissions) setState("prompt");
    return () => status?.removeEventListener("change", update);
  }, [name]);
  return state;
}

type PermissionStatus_ = globalThis.PermissionStatus;
