"use client";
import { motion, useReducedMotion } from "motion/react";
import type { TallyRow } from "@a-eye/shared";

/** Answer split. Bars have no background track; the leader carries the accent. */
export function TallyBars({ rows, size = "lg" }: { rows: TallyRow[]; size?: "lg" | "sm" }) {
  const reduce = useReducedMotion();
  const top = Math.max(...rows.map((r) => r.count));
  return (
    <ol className={size === "lg" ? "space-y-5" : "space-y-3"}>
      {rows.map((r) => {
        const lead = r.count > 0 && r.count === top;
        return (
          <li key={r.option}>
            <div className="flex items-baseline justify-between gap-4">
              <span className={`${size === "lg" ? "text-[16px]" : "text-[14px]"} ${lead ? "font-medium" : "text-muted"}`}>
                {r.option}
              </span>
              <span className="font-mono text-[13px] text-muted">
                <span className={`${size === "lg" ? "text-[22px]" : "text-[16px]"} font-semibold ${lead ? "text-ink" : ""}`}>
                  {r.pct}%
                </span>{" "}
                {r.count}
              </span>
            </div>
            <motion.div
              className={`mt-1.5 h-1.5 origin-left rounded-full ${lead ? "bg-accent" : "bg-muted/40"}`}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: Math.max(r.pct, 0.5) / 100 }}
              transition={{ type: "spring", stiffness: 100, damping: 20 }}
            />
          </li>
        );
      })}
    </ol>
  );
}
