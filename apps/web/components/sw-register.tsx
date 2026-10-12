"use client";
import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/sw-client";

export function ServiceWorkerRegister() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return null;
}
