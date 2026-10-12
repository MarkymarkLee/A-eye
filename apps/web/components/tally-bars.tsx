"use client";
import { motion, useReducedMotion } from "motion/react";
import type { TallyRow } from "@a-eye/shared";
import { cn } from "@/lib/cn";
import { AnimatedNumber } from "./ui/animated-number";

/** Answer split. Bars spring to new values as answers arrive; the leader carries the accent. */
export function TallyBars({ rows, size = "lg" }: { rows: TallyRow[]; size?: "lg" | "sm" }) {
  const reduce = useReducedMotion();
  const top = Math.max(...rows.map((r) => r.count));
  return (
    <ol className={size === "lg" ? "space-y-4" : "space-y-3"}>
      {rows.map((r) => {
        const lead = r.count > 0 && r.count === top;
        return (
          <li key={r.option}>
            <div className="flex items-baseline justify-between gap-4">
              <span className={cn(size === "lg" ? "text-[16px]" : "text-[14px]", lead ? "font-semibold" : "text-muted")}>{r.option}</span>
              <span className="text-[13px] tabular-nums text-muted">
                <AnimatedNumber
                  value={r.pct}
                  format={(n) => `${Math.round(n)}%`}
                  className={cn(size === "lg" ? "text-[22px]" : "text-[16px]", "font-semibold", lead && "text-ink")}
                />{" "}
                · {r.count}
              </span>
            </div>
            <div className={cn("mt-1.5 overflow-hidden rounded-full bg-surface-2", size === "lg" ? "h-3" : "h-2")}>
              <motion.div
                className={cn("h-full origin-left rounded-full", lead ? "bg-gradient-to-r from-accent to-accent-2" : "bg-muted/35")}
                initial={reduce ? false : { scaleX: 0 }}
                animate={{ scaleX: Math.max(r.pct, 1) / 100 }}
                transition={{ type: "spring", stiffness: 90, damping: 18 }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
