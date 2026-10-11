"use client";
import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};

/** A boolean persisted in localStorage. `null` during SSR so callers can avoid flashes. */
export function useLocalFlag(key: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    () => null,
  );
  const set = useCallback(
    (on: boolean) => {
      try {
        if (on) localStorage.setItem(key, "1");
        else localStorage.removeItem(key);
      } catch {
        // Private mode: keep the in-memory state only.
      }
      emit();
    },
    [key],
  );
  return [value, set] as const;
}
