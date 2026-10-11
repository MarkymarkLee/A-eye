"use client";
import { useSyncExternalStore } from "react";

const query = "(prefers-color-scheme: dark)";
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(query);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function useDark() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
