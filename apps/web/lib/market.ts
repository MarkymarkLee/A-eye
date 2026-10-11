import type { MarketComparison } from "@a-eye/shared";
import { getMarketQuestion, latestMarketQuestionIds } from "./store";
import { yesOptionIndex } from "./compare";
import { liveOdds } from "./gemini-odds";

export async function marketComparison(questionId: string): Promise<MarketComparison | undefined> {
  const data = await getMarketQuestion(questionId);
  const marketRef = data?.question.market_ref;
  if (!data || !marketRef) return undefined;

  const yesIndex = yesOptionIndex(data.options, marketRef);
  const responses = data.tally.reduce((sum, row) => sum + row.count, 0);
  const live = await liveOdds(marketRef);
  const impliedYes = live?.implied_yes ?? marketRef.implied_yes ?? null;
  const marketPct = impliedYes === null ? null : Math.round(impliedYes * 100);
  const askedMarketPct =
    typeof marketRef.implied_yes === "number" ? Math.round(marketRef.implied_yes * 100) : null;
  const crowdPct = responses > 0 ? data.tally[yesIndex]?.pct ?? 0 : null;

  return {
    question_id: data.question.id,
    prompt: data.question.prompt,
    status: data.question.status,
    market_ref: marketRef,
    yes_option: data.options[yesIndex] ?? data.options[0] ?? "",
    live,
    market_pct: marketPct,
    asked_market_pct: askedMarketPct,
    crowd_pct: crowdPct,
    responses,
    edge_pts: crowdPct === null || marketPct === null ? null : crowdPct - marketPct,
    trades: data.market_trades,
  };
}

export async function latestMarketComparisons(limit = 3): Promise<MarketComparison[]> {
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));
  const ids = await latestMarketQuestionIds(safeLimit);
  const comparisons = await Promise.all(ids.map((id) => marketComparison(id)));
  return comparisons.filter((comparison): comparison is MarketComparison => comparison !== undefined);
}
