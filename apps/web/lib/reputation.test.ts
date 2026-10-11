import { describe, expect, it } from "vitest";
import {
  agreement,
  badgesFor,
  computeStats,
  dayKey,
  majority,
  reputationOf,
  streaks,
  type AnswerRow,
  type WinRow,
} from "./reputation";

// 2026-10-12T20:00Z is midday Monday Oct 12 in America/Los_Angeles.
const NOW = new Date("2026-10-12T20:00:00.000Z");
const iso = (day: string, hour = 18) => `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;

let n = 0;
const ans = (observer: string, question: string, option: number, at: string, closed = true): AnswerRow => ({
  submission_id: `s${n++}`,
  observer_id: observer,
  question_id: question,
  option_index: option,
  captured_at: at,
  closed,
});

describe("dayKey", () => {
  it("maps a UTC timestamp to the LA calendar day across the boundary", () => {
    expect(dayKey("2026-10-11T06:30:00.000Z")).toBe("2026-10-10");
    expect(dayKey("2026-10-11T07:30:00.000Z")).toBe("2026-10-11");
    expect(dayKey("2026-10-11T06:30:00.000Z", "UTC")).toBe("2026-10-11");
  });
});

describe("streaks", () => {
  it("counts today/yesterday/2-days-ago as a current streak of 3", () => {
    const t = streaks([iso("2026-10-12"), iso("2026-10-11"), iso("2026-10-10")], NOW);
    expect(t).toEqual({ current: 3, best: 3 });
  });

  it("reports current 0 when the latest answer was 2 days ago but keeps the best", () => {
    const t = streaks([iso("2026-10-10"), iso("2026-10-09"), iso("2026-10-08")], NOW);
    expect(t).toEqual({ current: 0, best: 3 });
  });

  it("counts multiple answers on the same day once", () => {
    const t = streaks([iso("2026-10-12", 8), iso("2026-10-12", 20), iso("2026-10-11")], NOW);
    expect(t).toEqual({ current: 2, best: 2 });
  });

  it("best is the longest run across a gap", () => {
    const t = streaks([iso("2026-10-12"), iso("2026-10-11"), iso("2026-10-07"), iso("2026-10-06"), iso("2026-10-05")], NOW);
    expect(t).toEqual({ current: 2, best: 3 });
  });

  it("empty history is 0/0", () => {
    expect(streaks([], NOW)).toEqual({ current: 0, best: 0 });
  });

  it("a run ending yesterday still counts as current", () => {
    const t = streaks([iso("2026-10-11"), iso("2026-10-10")], NOW);
    expect(t).toEqual({ current: 2, best: 2 });
  });
});

describe("majority", () => {
  it("returns the winner and null on empty or a top tie", () => {
    expect(majority([0, 0, 1])).toBe(0);
    expect(majority([1, 1, 2, 2])).toBeNull();
    expect(majority([])).toBeNull();
  });
});

describe("agreement (leave-one-out)", () => {
  it("does not score a lone answer", () => {
    const m = agreement([ans("a", "q1", 0, iso("2026-10-10"))]);
    expect(m.get("a")).toBeUndefined();
  });

  it("ignores answers on open questions", () => {
    const m = agreement([
      ans("a", "q1", 0, iso("2026-10-10"), false),
      ans("b", "q1", 0, iso("2026-10-10"), false),
    ]);
    expect(m.size).toBe(0);
  });

  it("skips scoring when the other answers are tied", () => {
    const m = agreement([
      ans("a", "q1", 0, iso("2026-10-10")),
      ans("b", "q1", 0, iso("2026-10-10")),
      ans("c", "q1", 1, iso("2026-10-10")),
    ]);
    // a and b see a {0,1} tie among the others -> skipped. c sees {0,0} -> scored, disagreed.
    expect(m.get("a")).toBeUndefined();
    expect(m.get("b")).toBeUndefined();
    expect(m.get("c")).toEqual({ agreed: 0, scored: 1 });
  });

  it("counts matches and mismatches", () => {
    const m = agreement([
      ans("a", "q1", 1, iso("2026-10-10")),
      ans("b", "q1", 1, iso("2026-10-10")),
      ans("c", "q1", 1, iso("2026-10-10")),
      ans("d", "q1", 0, iso("2026-10-10")),
    ]);
    expect(m.get("a")).toEqual({ agreed: 1, scored: 1 });
    expect(m.get("d")).toEqual({ agreed: 0, scored: 1 });
  });
});

describe("computeStats", () => {
  const answers = [
    ans("a", "q1", 1, iso("2026-10-12")), // today, out of the week window edge
    ans("a", "q2", 0, iso("2026-10-05")), // 7 days ago
    ans("a", "q3", 0, iso("2026-09-20")), // old
    ans("b", "q1", 1, iso("2026-10-12")),
    ans("b", "q4", 0, iso("2026-10-12")),
  ];
  const wins: WinRow[] = [
    { submission_id: "w1", observer_id: "a", captured_at: iso("2026-09-20"), prize: 1.8 },
  ];

  it("windows counts with `since` but keeps all-time streak/agreement/badges", () => {
    const since = iso("2026-10-06");
    const stats = computeStats(answers, wins, { now: NOW, since });
    const a = stats.get("a")!;
    expect(a.verified_answers).toBe(1); // only today's answer is inside the window
    expect(a.questions_won).toBe(0); // win was Sep 20, outside the window
    expect(a.ausd_earned).toBe(0);
    expect(a.best_streak).toBeGreaterThanOrEqual(1);
    expect(a.badges).toContain("first_eyes"); // badge from all-time verified_answers
    expect(a.badges).toContain("raffle_winner"); // all-time win still counts for badges
    const all = computeStats(answers, wins, { now: NOW });
    expect(all.get("a")!.verified_answers).toBe(3);
    expect(all.get("a")!.questions_won).toBe(1);
    expect(all.get("a")!.ausd_earned).toBe(1.8);
  });

  it("applies sharpshooter thresholds", () => {
    const mk = (observer: string, scores: number[]) =>
      scores.map((opt, i) => {
        const q = `q_${observer}_${i}`;
        return [
          ans(observer, q, opt, iso("2026-10-10")),
          ans("x1", q, 0, iso("2026-10-10")),
          ans("x2", q, 0, iso("2026-10-10")),
        ];
      }).flat();
    // 4 scored at 100% -> no badge
    const perfect4 = computeStats(mk("p4", [0, 0, 0, 0]), [], { now: NOW }).get("p4")!;
    expect(perfect4.agreement_scored).toBe(4);
    expect(perfect4.agreement_rate).toBe(1);
    expect(perfect4.badges).not.toContain("sharpshooter");
    // 5 scored at 80% -> badge
    const five80 = computeStats(mk("p5", [0, 0, 0, 0, 1]), [], { now: NOW }).get("p5")!;
    expect(five80.agreement_scored).toBe(5);
    expect(five80.agreement_rate).toBe(0.8);
    expect(five80.badges).toContain("sharpshooter");
    // 5 scored at 60% -> no badge
    const five60 = computeStats(mk("p6", [0, 0, 0, 1, 1]), [], { now: NOW }).get("p6")!;
    expect(five60.agreement_rate).toBe(0.6);
    expect(five60.badges).not.toContain("sharpshooter");
  });
});

describe("badgesFor / reputationOf", () => {
  it("orders badges by BADGES order", () => {
    const b = badgesFor({
      verified_answers: 3,
      questions_won: 1,
      ausd_earned: 2,
      current_streak: 4,
      best_streak: 4,
      agreement_rate: 0.9,
      agreement_scored: 6,
      agreement_agreed: 5,
    });
    expect(b).toEqual(["first_eyes", "streak_3", "raffle_winner", "sharpshooter"]);
  });

  it("reputationOf projects the reputation fields", () => {
    expect(
      reputationOf({
        verified_answers: 12,
        questions_won: 0,
        ausd_earned: 0,
        current_streak: 1,
        best_streak: 3,
        agreement_rate: 0.86,
        agreement_scored: 7,
        agreement_agreed: 6,
        badges: [],
      }),
    ).toEqual({ agreement_rate: 0.86, scored_answers: 7, answer_count: 12 });
  });
});
