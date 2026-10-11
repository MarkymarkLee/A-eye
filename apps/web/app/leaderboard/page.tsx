import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { leaderboard } from "@/lib/store";
import { peekObserverId } from "@/lib/observer";
import type { LeaderboardRange } from "@/lib/reputation";
import { BadgeIcons, pct } from "@/components/badges";
import { TestMoney } from "@/components/ui/test-money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Leaderboard",
  description: "The people giving AI agents eyes on the ground, ranked by verified answers.",
};

const RANGES: { id: LeaderboardRange; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "all", label: "All time" },
];

const COLS = "grid-cols-[2rem_1fr_auto] md:grid-cols-[3rem_1fr_6rem_5rem_6rem_6rem_7rem]";

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const range: LeaderboardRange = sp.range === "all" ? "all" : "week";
  const entries = await leaderboard(range, await peekObserverId());

  return (
    <main className="mx-auto max-w-[1200px] px-4 pb-24 pt-8 md:px-6 md:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Leaderboard</h1>
          <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-muted">
            The people giving AI agents eyes on the ground, ranked by verified answers.
          </p>
          <TestMoney className="mt-3" />
        </div>
        <nav aria-label="Time range" className="flex gap-1 rounded-full bg-surface-2 p-1 text-sm">
          {RANGES.map((r) => (
            <Link
              key={r.id}
              href={r.id === "week" ? "/leaderboard" : "/leaderboard?range=all"}
              aria-current={r.id === range ? "page" : undefined}
              className={`rounded-full px-3.5 py-1.5 transition-colors ${
                r.id === range ? "bg-surface text-ink shadow-panel" : "text-muted hover:text-ink"
              }`}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </div>

      {entries.length === 0 ? (
        <div className="mt-10 rounded-[16px] border border-dashed border-line px-5 py-10">
          <p className="text-lg font-medium">No verified answers {range === "week" ? "this week" : "yet"}.</p>
          <p className="mt-1 text-[14px] text-muted">The first person to answer takes the top spot.</p>
          <Link href="/" className="btn btn-ghost mt-5">
            Find questions near you <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <div className="mt-8">
          <div className={`hidden ${COLS} gap-x-4 border-b border-line pb-2 text-[12.5px] text-muted md:grid`}>
            <span>#</span>
            <span>Observer</span>
            <span className="text-right">Answers</span>
            <span className="text-right">Won</span>
            <span className="text-right">AUSD</span>
            <span className="text-right">Streak</span>
            <span className="text-right">Agreement</span>
          </div>
          <ol className="divide-y divide-line">
            {entries.map((e) => (
              <li
                key={`${e.rank}-${e.display_name}`}
                className={`grid ${COLS} items-center gap-x-4 py-4 ${e.is_you ? "-mx-3 rounded-[14px] bg-accent/8 px-3" : ""}`}
              >
                <span
                  className={`font-mono text-[15px] tabular-nums ${e.rank <= 3 ? "font-semibold text-accent-ink" : "text-muted"}`}
                >
                  {e.rank}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-medium">{e.display_name}</span>
                    {e.is_you && (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-on-accent">You</span>
                    )}
                    <BadgeIcons badges={e.badges} />
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted md:hidden">
                    {pct(e.agreement_rate)} agreement · {e.current_streak}-day streak
                    {e.questions_won > 0 && ` · won ${e.ausd_earned} AUSD`}
                  </p>
                </div>
                <span className="text-right">
                  <span className="block text-xl font-semibold tabular-nums md:text-[15px] md:font-medium">{e.verified_answers}</span>
                  <span className="block text-[12px] text-muted md:hidden">answers</span>
                </span>
                <span className="hidden text-right tabular-nums md:block">{e.questions_won}</span>
                <span className="hidden text-right tabular-nums md:block">{e.ausd_earned}</span>
                <span className="hidden text-right tabular-nums md:block">
                  {e.current_streak} {e.current_streak === 1 ? "day" : "days"}
                </span>
                <span className="hidden text-right tabular-nums md:block" title={`${e.agreement_scored} closed questions scored`}>
                  {pct(e.agreement_rate)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="mt-10 max-w-[68ch] text-[13px] leading-relaxed text-muted">
        {range === "week" && "Answers, wins and AUSD count the last 7 days. Streaks, agreement and badges are all-time. "}
        Agreement is how often someone&apos;s answer matched the majority of the other answers on closed questions. Agents get it
        with every photo, so they can weigh the evidence.
      </p>
    </main>
  );
}
