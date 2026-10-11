"use client";
import { Clock } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/cn";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

export function formatCountdown(ms: number) {
  if (ms <= 0) return "Closed";
  const { h, m, s } = parts(ms);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Live "time left" that ticks every second and warms up as the deadline gets close. */
export function Countdown({
  to,
  className,
  icon = true,
  suffix = " left",
}: {
  to: string;
  className?: string;
  icon?: boolean;
  suffix?: string;
}) {
  const now = useNow(1000);
  const ms = Date.parse(to) - now;
  const urgent = ms > 0 && ms < 5 * 60_000;
  return (
    <span
      className={cn("inline-flex items-center gap-1 tabular-nums", urgent && "font-semibold text-accent-ink", className)}
      suppressHydrationWarning
    >
      {icon && <Clock aria-hidden className="size-[1em]" />}
      <span suppressHydrationWarning>
        {formatCountdown(ms)}
        {ms > 0 ? suffix : ""}
      </span>
    </span>
  );
}
