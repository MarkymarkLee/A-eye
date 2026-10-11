"use client";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Sprout } from "lucide-react";
import { cn } from "@/lib/cn";

export const TEST_MONEY_NOTE = "Practice dollars on a test network, not real cash.";

/**
 * One friendly "Test money" pill per money card or section. Tap, hover or focus it for the
 * explanation. `onAccent` is for gradient/solid accent surfaces like the raffle ticket.
 */
export function TestMoney({ className, tone = "neutral", align = "start" }: { className?: string; tone?: "neutral" | "onAccent"; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);

  return (
    <span ref={ref} className={cn("relative inline-flex", className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-describedby={id}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={cn(
          "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap normal-case tracking-normal rounded-full px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          tone === "onAccent"
            ? "bg-white/20 text-white hover:bg-white/30"
            : "bg-[color-mix(in_oklab,var(--ok)_12%,var(--surface))] text-ok hover:bg-[color-mix(in_oklab,var(--ok)_18%,var(--surface))]",
        )}
      >
        <Sprout className="size-3.5" aria-hidden /> Test money
      </button>
      <span id={id} role="tooltip" className="sr-only">
        Test money: {TEST_MONEY_NOTE}
      </span>
      <AnimatePresence>
        {open && (
          <motion.span
            aria-hidden
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className={cn(
              "absolute top-full z-40 mt-2 w-[min(240px,80vw)] rounded-[14px] bg-ink px-3.5 py-2.5 text-left text-[13px] font-normal normal-case leading-snug tracking-normal text-bg shadow-lift",
              align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            )}
          >
            <b className="font-semibold">Test money.</b> {TEST_MONEY_NOTE}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** The one-line site-wide note. */
export function TestMoneyFooter() {
  return (
    <footer className="mx-auto flex max-w-[1200px] items-center justify-center gap-2 px-4 pb-6 pt-4 text-center text-[12.5px] leading-snug text-muted md:px-6">
      <Sprout className="size-3.5 shrink-0 text-ok" aria-hidden />
      <span>A-eye runs on test networks, so every prize is test money: practice dollars, not real cash.</span>
    </footer>
  );
}
