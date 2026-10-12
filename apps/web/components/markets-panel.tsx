"use client";

import { useEffect, useState } from "react";
import type { MarketComparison } from "@a-eye/shared";
import { MarketVsHumans } from "./market-vs-humans";

export function MarketsPanel({ initial }: { initial: MarketComparison[] }) {
  const [markets, setMarkets] = useState(initial);

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/markets?limit=3", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { markets: MarketComparison[] };
        if (!stopped) setMarkets(data.markets);
      } catch {
        // Keep the last successful list visible while offline.
      }
    };
    const interval = setInterval(refresh, 5000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, []);

  if (markets.length === 0) return null;
  return (
    <section className="mt-6" aria-label="Live prediction market comparisons">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Market vs Humans</h2>
      <div className="grid gap-3 lg:grid-cols-3">
        {markets.map((market) => (
          <MarketVsHumans key={market.question_id} questionId={market.question_id} initial={market} poll={false} />
        ))}
      </div>
    </section>
  );
}
