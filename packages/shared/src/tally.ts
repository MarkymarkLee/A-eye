import type { TallyEntry } from "./schemas.js";

export function tally(options: readonly string[], optionIndexes: readonly number[]): TallyEntry[] {
  const counts = options.map(() => 0);
  for (const i of optionIndexes) {
    if (Number.isInteger(i) && i >= 0 && i < counts.length) counts[i]! += 1;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  return options.map((option, i) => ({
    option,
    count: counts[i]!,
    pct: total === 0 ? 0 : Math.round((counts[i]! / total) * 1000) / 10,
  }));
}
