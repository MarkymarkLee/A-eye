import type { TallyRow } from "@a-eye/shared";

/** Percentages use largest-remainder rounding so they always sum to 100. */
export function tally(options: string[], picks: number[]): TallyRow[] {
  const counts = options.map((_, i) => picks.filter((p) => p === i).length);
  const total = picks.length;
  if (total === 0) return options.map((option) => ({ option, count: 0, pct: 0 }));
  const raw = counts.map((c) => (c / total) * 100);
  const floored = raw.map(Math.floor);
  let remainder = 100 - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floored[i]! += 1;
    remainder -= 1;
  }
  return options.map((option, i) => ({ option, count: counts[i]!, pct: floored[i]! }));
}
