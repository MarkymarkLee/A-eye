"use client";
import * as T from "@radix-ui/react-tabs";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";

export type TabItem = { value: string; label: string; icon?: React.ReactNode; count?: number; content: React.ReactNode };

/**
 * Segmented tabs (Radix) with a springy active pill. Use them to split a long page into short panels.
 * With `hashSync`, `#value` links open that tab and scroll it into view.
 */
export function Tabs({
  items,
  label,
  hashSync,
  className,
  listClassName,
}: {
  items: TabItem[];
  label: string;
  hashSync?: boolean;
  className?: string;
  listClassName?: string;
}) {
  const [value, setValue] = useState(items[0]!.value);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const keys = items.map((i) => i.value).join("|");

  useEffect(() => {
    if (!hashSync) return;
    const sync = (scroll: boolean) => {
      const h = decodeURIComponent(location.hash.slice(1));
      if (!keys.split("|").includes(h)) return;
      setValue(h);
      if (scroll) root.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    };
    sync(true);
    const onHash = () => sync(true);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [hashSync, keys, reduce]);

  return (
    <T.Root
      ref={root}
      value={value}
      onValueChange={(v) => {
        setValue(v);
        haptic("select");
        if (hashSync) history.replaceState(null, "", `#${v}`);
      }}
      className={cn("scroll-mt-24", className)}
    >
      <T.List
        aria-label={label}
        className={cn("flex gap-1 overflow-x-auto rounded-full bg-surface-2 p-1 [scrollbar-width:none]", listClassName)}
      >
        {items.map((i) => (
          <T.Trigger
            key={i.value}
            value={i.value}
            className="relative flex min-h-11 flex-1 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 text-[14px] font-semibold text-muted outline-none md:px-4 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent data-[state=active]:text-ink"
          >
            {value === i.value && (
              <motion.span
                layoutId={`${id}-pill`}
                aria-hidden
                className="absolute inset-0 rounded-full bg-surface shadow-panel ring-1 ring-line"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {i.icon}
              {i.label}
              {i.count !== undefined && (
                <span className="rounded-full bg-surface-3 px-1.5 text-[12px] tabular-nums text-muted">{i.count}</span>
              )}
            </span>
          </T.Trigger>
        ))}
      </T.List>
      {items.map((i) => (
        <T.Content key={i.value} value={i.value} className="mt-5 rounded-[18px] outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            {i.content}
          </motion.div>
        </T.Content>
      ))}
    </T.Root>
  );
}
