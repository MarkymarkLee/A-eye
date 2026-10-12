import type { ObserverReputation } from "@a-eye/shared";
import { roundAmount } from "./money";

/*
 * Observer stats and reputation. Pure functions over answer/win rows so the
 * whole module is unit-testable without a database. Streak days are counted
 * in the venue's time zone (Berkeley), not UTC.
 */

export const STREAK_TIME_ZONE = "America/Los_Angeles";

export type BadgeId = "first_eyes" | "streak_3" | "raffle_winner" | "sharpshooter";

export const BADGES: Record<BadgeId, { label: string; description: string }> = {
  first_eyes: { label: "First Eyes", description: "Sent at least one verified answer" },
  streak_3: { label: "3-day streak", description: "Answered on three days in a row" },
  raffle_winner: { label: "Raffle Winner", description: "Won a question raffle" },
  sharpshooter: { label: "Sharpshooter", description: "Agrees with the crowd on most closed questions" },
};

export const SHARPSHOOTER = { minScored: 5, minRate: 0.8 };

export type AnswerRow = {
  submission_id: string;
  observer_id: string;
  question_id: string;
  option_index: number;
  captured_at: string;
  closed: boolean;
};

export type WinRow = {
  submission_id: string;
  observer_id: string;
  captured_at: string;
  prize: number;
};

export type ObserverStats = {
  verified_answers: number;
  questions_won: number;
  ausd_earned: number;
  current_streak: number;
  best_streak: number;
  agreement_rate: number | null;
  agreement_scored: number;
  agreement_agreed: number;
  badges: BadgeId[];
};

export type LeaderboardRange = "week" | "all";

export type LeaderboardEntry = ObserverStats & { rank: number; display_name: string; is_you: boolean };

const DAY_MS = 86_400_000;

/** Calendar day "YYYY-MM-DD" in the given time zone. */
export function dayKey(iso: string, timeZone = STREAK_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Day index from a "YYYY-MM-DD" key, via UTC so DST never shifts the math. */
const dayNum = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / DAY_MS;
};

export function streaks(
  isoTimes: string[],
  now: Date,
  timeZone = STREAK_TIME_ZONE,
): { current: number; best: number } {
  const days = [...new Set(isoTimes.map((t) => dayNum(dayKey(t, timeZone))))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1]! + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const today = dayNum(dayKey(now.toISOString(), timeZone));
  const last = days[days.length - 1];
  const current = last === today || last === today - 1 ? run : 0;
  return { current, best };
}

/** Winning option index, or null when empty or tied for the top. */
export function majority(optionIndexes: number[]): number | null {
  if (optionIndexes.length === 0) return null;
  const counts = new Map<number, number>();
  for (const o of optionIndexes) counts.set(o, (counts.get(o) ?? 0) + 1);
  const max = Math.max(...counts.values());
  const tops = [...counts.entries()].filter(([, c]) => c === max);
  return tops.length === 1 ? tops[0]![0] : null;
}

/**
 * Leave-one-out agreement per observer: each answer on a closed question is
 * compared with the majority of the OTHER answers on that question. A lone
 * answer, a tied majority, or an open question is never scored.
 */
export function agreement(answers: AnswerRow[]): Map<string, { agreed: number; scored: number }> {
  const byQuestion = new Map<string, AnswerRow[]>();
  for (const a of answers) {
    if (!a.closed) continue;
    const rows = byQuestion.get(a.question_id) ?? [];
    rows.push(a);
    byQuestion.set(a.question_id, rows);
  }
  const out = new Map<string, { agreed: number; scored: number }>();
  for (const rows of byQuestion.values()) {
    for (const a of rows) {
      const m = majority(rows.filter((r) => r.submission_id !== a.submission_id).map((r) => r.option_index));
      if (m === null) continue;
      const e = out.get(a.observer_id) ?? { agreed: 0, scored: 0 };
      e.scored += 1;
      if (a.option_index === m) e.agreed += 1;
      out.set(a.observer_id, e);
    }
  }
  return out;
}

export function badgesFor(s: Omit<ObserverStats, "badges">): BadgeId[] {
  const out: BadgeId[] = [];
  if (s.verified_answers >= 1) out.push("first_eyes");
  if (s.best_streak >= 3) out.push("streak_3");
  if (s.questions_won >= 1) out.push("raffle_winner");
  if (s.agreement_scored >= SHARPSHOOTER.minScored && (s.agreement_rate ?? 0) >= SHARPSHOOTER.minRate)
    out.push("sharpshooter");
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Stats per observer. `since` windows verified_answers / questions_won /
 * ausd_earned; streaks, agreement and badges always use all-time data.
 * The map contains every observer with at least one answer (all-time).
 */
export function computeStats(
  answers: AnswerRow[],
  wins: WinRow[],
  opts: { now: Date; since?: string },
): Map<string, ObserverStats> {
  const sinceMs = opts.since === undefined ? undefined : Date.parse(opts.since);
  const inWindow = (iso: string) => sinceMs === undefined || Date.parse(iso) >= sinceMs;

  const answersBy = new Map<string, AnswerRow[]>();
  for (const a of answers) {
    const rows = answersBy.get(a.observer_id) ?? [];
    rows.push(a);
    answersBy.set(a.observer_id, rows);
  }
  const winsBy = new Map<string, WinRow[]>();
  for (const w of wins) {
    const rows = winsBy.get(w.observer_id) ?? [];
    rows.push(w);
    winsBy.set(w.observer_id, rows);
  }
  const agree = agreement(answers);

  const out = new Map<string, ObserverStats>();
  for (const [observerId, rows] of answersBy) {
    const obsWins = winsBy.get(observerId) ?? [];
    const ag = agree.get(observerId) ?? { agreed: 0, scored: 0 };
    const streak = streaks(
      rows.map((r) => r.captured_at),
      opts.now,
    );
    const base = {
      verified_answers: rows.filter((r) => inWindow(r.captured_at)).length,
      questions_won: obsWins.filter((w) => inWindow(w.captured_at)).length,
      ausd_earned: roundAmount(obsWins.filter((w) => inWindow(w.captured_at)).reduce((s, w) => s + w.prize, 0)),
      current_streak: streak.current,
      best_streak: streak.best,
      agreement_rate: ag.scored > 0 ? round2(ag.agreed / ag.scored) : null,
      agreement_scored: ag.scored,
      agreement_agreed: ag.agreed,
    };
    out.set(observerId, {
      ...base,
      badges: badgesFor({ ...base, verified_answers: rows.length, questions_won: obsWins.length }),
    });
  }
  return out;
}

/** Reputation attached to each evidence item. Feed it all-time stats only. */
export function reputationOf(s: ObserverStats): ObserverReputation {
  return {
    agreement_rate: s.agreement_rate,
    scored_answers: s.agreement_scored,
    answer_count: s.verified_answers,
  };
}
