"use client";
import { useSyncExternalStore } from "react";

/** True when the resolved theme (html[data-theme]) is dark. */
const subscribe = (cb: () => void) => {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
};

export function useDark() {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme === "dark", () => false);
}
