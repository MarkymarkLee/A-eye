"use client";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Coins, Eye, Hourglass, Trophy, Undo2 } from "lucide-react";
import type { AusdFlow } from "@a-eye/shared";
import { ago } from "@/lib/time";
import { cn } from "@/lib/cn";

export type MoneyFlow = Omit<AusdFlow, "url"> & { url?: string; question_id?: string; prompt?: string };

const basescan = (tx: string) => `https://sepolia.basescan.org/tx/${tx}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
const who = (label: string) => (label === "agent" ? "the agent" : label.startsWith("agent ") ? `agent ${label.slice(6)}` : label);

const STEP: Record<AusdFlow["kind"], { icon: typeof Coins; title: string; tone: "in" | "out" }> = {
  bounty: { icon: Coins, title: "Prize put up", tone: "in" },
  peek: { icon: Eye, title: "Early look bought", tone: "in" },
  payout: { icon: Trophy, title: "Winner paid", tone: "out" },
  refund: { icon: Undo2, title: "Money sent back", tone: "out" },
};

function line(f: MoneyFlow) {
  switch (f.kind) {
    case "bounty":
      return `${who(f.from_label)} paid the prize into the pot`;
    case "peek":
      return `${who(f.from_label)} paid to see answers early. It all goes into the pot`;
    case "payout":
      return `${f.to_label} got 90% of the pot`;
    case "refund":
      return `Not enough answers came in, so ${who(f.to_label)} got its prize back`;
  }
}

/**
 * Animated, plain-language timeline of real AUSD movements (bounty → peek → payout/refund), each with a BaseScan receipt.
 * `pending` adds a dashed final step while the question is still open.
 */
export function MoneyTimeline({ flows, pending, showQuestion, className }: { flows: MoneyFlow[]; pending?: string; showQuestion?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <ol className={cn("relative grid", className)}>
      {flows.map((f, i) => {
        const s = STEP[f.kind];
        const last = i === flows.length - 1 && !pending;
        return (
          <motion.li
            key={`${f.kind}-${f.tx}`}
            initial={reduce ? false : { opacity: 0, x: -10 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-20px" }}
            transition={{ delay: i * 0.12, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-x-3"
          >
            {!last && (
              <motion.span
                aria-hidden
                initial={reduce ? false : { scaleY: 0 }}
                whileInView={{ scaleY: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12 + 0.2, duration: 0.5, ease: "easeOut" }}
                className="absolute left-[19px] top-10 bottom-0 w-0.5 origin-top rounded-full bg-gradient-to-b from-accent/50 to-line"
              />
            )}
            <span
              className={cn(
                "relative z-10 grid size-10 place-items-center rounded-[14px] shadow-panel",
                s.tone === "out" ? "bg-gradient-to-br from-accent to-accent-2 text-white" : "bg-accent-soft text-accent-ink",
              )}
            >
              <s.icon className="size-[18px]" aria-hidden />
            </span>
            <div className={cn("min-w-0", last ? "pb-1" : "pb-5")}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[15px] font-semibold tracking-tight">{s.title}</p>
                <p className={cn("shrink-0 font-mono text-[15px] font-semibold tabular-nums", s.tone === "out" ? "text-accent-ink" : "text-ink")}>
                  {s.tone === "out" ? "−" : "+"}
                  {fmt(f.amount)} <span className="text-[12px] font-medium text-muted">{f.currency}</span>
                </p>
              </div>
              <p className="mt-0.5 text-[13.5px] leading-snug text-muted">
                {line(f)}
                {f.at ? ` · ${ago(f.at)}` : ""}
              </p>
              {showQuestion && f.prompt && f.question_id && (
                <Link href={`/q/${f.question_id}`} className="mt-1 block truncate text-[13px] font-medium hover:underline">
                  {f.prompt}
                </Link>
              )}
              <a
                href={f.url ?? basescan(f.tx)}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex min-h-8 items-center gap-1 rounded-full bg-surface-2 px-2.5 text-[12.5px] font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink"
                aria-label={`See the ${s.title.toLowerCase()} receipt on BaseScan`}
              >
                Receipt on BaseScan <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            </div>
          </motion.li>
        );
      })}
      {pending && (
        <motion.li
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: flows.length * 0.12, duration: 0.4 }}
          className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3"
        >
          <span className="grid size-10 place-items-center rounded-[14px] border-2 border-dashed border-line text-muted">
            <Hourglass className="size-[18px]" aria-hidden />
          </span>
          <p className="self-center text-[13.5px] leading-snug text-muted">{pending}</p>
        </motion.li>
      )}
    </ol>
  );
}

/** "Pot = prize + early looks, winner gets 90%" in plain words. */
export function PotBreakdown({ prize, pot, currency, fee }: { prize: number; pot: number; currency: string; fee: number }) {
  const peeks = Math.max(0, Math.round((pot - prize) * 1000) / 1000);
  const winner = Math.round(pot * (1 - fee) * 1000) / 1000;
  const cells = [
    { label: "Prize", value: prize, hint: "from the agent" },
    { label: "Early looks", value: peeks, hint: "added by agents" },
    { label: "Winner gets", value: winner, hint: `${Math.round((1 - fee) * 100)}% of the pot`, hot: true },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2">
      {cells.map((c) => (
        <div key={c.label} className={cn("min-w-0 rounded-[14px] p-3", c.hot ? "bg-accent-soft text-accent-ink" : "bg-surface-2")}>
          <dt className={cn("text-[12px] font-medium", !c.hot && "text-muted")}>{c.label}</dt>
          <dd className="mt-0.5 font-mono text-[17px] font-semibold tabular-nums">
            {fmt(c.value)} <span className={cn("text-[11px] font-medium", !c.hot && "text-muted")}>{currency}</span>
          </dd>
          <dd className={cn("text-[11.5px] leading-tight", !c.hot && "text-muted")}>{c.hint}</dd>
        </div>
      ))}
    </dl>
  );
}
