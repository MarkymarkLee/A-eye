"use client";
import { useEffect, useState } from "react";

/** Current time, re-rendered every `intervalMs`. Starts at 0 on the server to avoid hydration mismatches. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
