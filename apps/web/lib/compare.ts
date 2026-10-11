import type { MarketRef, TallyRow } from "@a-eye/shared";

export function humanLeader(tally: TallyRow[]): TallyRow | undefined {
  let leader: TallyRow | undefined;
  for (const row of tally) {
    if (!leader || row.count > leader.count) leader = row;
  }
  return leader?.count ? leader : undefined;
}

export type WebVsHumans = { web: string; source: string; web_option?: string; humans?: TallyRow; agree?: boolean };

export function webVsHumans(
  baseline: { answer: string; source: string; option_index?: number | null; option?: string | null } | undefined,
  tally: TallyRow[],
): WebVsHumans | undefined {
  if (!baseline) return undefined;
  const humans = humanLeader(tally);
  const index = baseline.option_index;
  const validIndex = typeof index === "number" && Number.isInteger(index) && index >= 0 && index < tally.length;
  const result: WebVsHumans = { web: baseline.answer, source: baseline.source };
  const webOption = baseline.option ?? (validIndex ? tally[index]!.option : undefined);
  if (webOption !== undefined) result.web_option = webOption;
  if (humans) result.humans = humans;
  if (validIndex && humans) result.agree = tally[index]!.count === humans.count;
  return result;
}

export function yesOptionIndex(options: string[], market?: MarketRef): number {
  const yesIndex: unknown = market?.yes_option_index;
  if (typeof yesIndex === "number" && Number.isInteger(yesIndex) && yesIndex >= 0 && yesIndex < options.length) {
    return yesIndex;
  }
  const firstYes = options.findIndex((option) => /^\s*yes\b/i.test(option));
  return firstYes >= 0 ? firstYes : 0;
}

export type MarketVsHumans = {
  provider: string;
  label?: string;
  market_pct: number;
  humans_pct: number | null;
  yes_option: string;
  gap: number | null;
};

export function marketVsHumans(
  market: MarketRef | undefined,
  options: string[],
  tally: TallyRow[],
): MarketVsHumans | undefined {
  if (!market || typeof market.implied_yes !== "number") return undefined;
  const yesIdx = yesOptionIndex(options, market);
  const marketPct = Math.round(market.implied_yes * 100);
  const total = tally.reduce((sum, row) => sum + row.count, 0);
  const humansPct = total > 0 ? tally[yesIdx]?.pct ?? 0 : null;
  return {
    provider: market.provider,
    label: market.label,
    market_pct: marketPct,
    humans_pct: humansPct,
    yes_option: options[yesIdx] ?? options[0] ?? "",
    gap: humansPct === null ? null : humansPct - marketPct,
  };
}
