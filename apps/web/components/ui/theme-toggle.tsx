"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type Pref = "system" | "light" | "dark";
const KEY = "aeye:theme";

/** Runs before paint (inlined in layout.tsx) so there is no light flash in dark mode. */
export const themeScript = `(function(){try{var p=localStorage.getItem("${KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;

function apply(pref: Pref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useState<Pref>("system");
  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Pref | null) ?? "system";
    setPref(saved);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => (localStorage.getItem(KEY) ?? "system") === "system" && apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const next: Record<Pref, Pref> = { system: "light", light: "dark", dark: "system" };
  const Icon = pref === "dark" ? Moon : pref === "light" ? Sun : Monitor;
  const label = { system: "Theme: match device", light: "Theme: light", dark: "Theme: dark" }[pref];
  return (
    <button
      type="button"
      onClick={() => {
        const p = next[pref];
        setPref(p);
        localStorage.setItem(KEY, p);
        apply(p);
      }}
      aria-label={`${label}. Tap to change.`}
      title={label}
      className={cn("grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink", className)}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}
