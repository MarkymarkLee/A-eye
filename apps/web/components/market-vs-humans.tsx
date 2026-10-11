"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MarketComparison, MarketTrade } from "@a-eye/shared";
import { Card } from "@/components/ui/card";
import { Badge, LiveDot } from "@/components/ui/badge";
import { AnimatedNumber } from "@/components/ui/animated-number";

function edgeLabel(edge: number) {
  if (edge === 0) return "Crowd at market";
  return `Crowd ${Math.abs(edge).toFixed(1)} pts ${edge > 0 ? "above" : "below"}`;
}

function shortOrderId(id: string) {
  return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

function TradeRow({ trade }: { trade: MarketTrade }) {
  const label = trade.side === "none" ? "NO TRADE" : `BUY ${trade.outcome.toUpperCase()}`;
  const statusTone =
    trade.status === "filled" || trade.status === "partially_filled"
      ? "ok"
      : trade.status === "rejected"
        ? "bad"
        : "neutral";
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">{label}</span>
        {trade.dry_run ? (
          <Badge tone="warn">dry run</Badge>
        ) : (
          <Badge tone={statusTone}>{trade.status.replaceAll("_", " ")}</Badge>
        )}
        {trade.order_id && <span className="font-mono text-[11px] text-muted">#{shortOrderId(trade.order_id)}</span>}
      </div>
      {trade.dry_run ? (
        <p className="mt-1 text-[12.5px] text-muted">dry run · {trade.reason || "order not submitted"}</p>
      ) : (
        <>
          <p className="mt-1 text-[12.5px] text-muted">
            {trade.quantity} @ ${trade.price.toFixed(2)}
          </p>
          <p className="mt-1 text-[12px] text-muted">
            Filled {trade.filled_quantity}
            {trade.avg_price !== null ? ` @ $${trade.avg_price.toFixed(2)} average` : ""}
          </p>
        </>
      )}
    </div>
  );
}

export function MarketVsHumans({
  questionId,
  initial,
  poll = true,
}: {
  questionId: string;
  initial?: MarketComparison;
  poll?: boolean;
}) {
  const [comparison, setComparison] = useState(initial);
  useEffect(() => {
    if (!poll) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/questions/${encodeURIComponent(questionId)}/market`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const next = (await response.json()) as MarketComparison;
        if (!stopped) setComparison(next);
      } catch {
        // Keep the latest good comparison visible while offline.
      }
    };
    void refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [poll, questionId]);

  if (!comparison) {
    return (
      <Card className="p-4" aria-label="Market versus humans">
        <p className="text-sm text-muted">Loading market odds…</p>
      </Card>
    );
  }

  const latestTrade = comparison.trades.at(-1);
  const symbol = comparison.market_ref.contract_symbol;
  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
          {comparison.live && <LiveDot />}
          Market vs Humans
        </p>
        {comparison.edge_pts !== null && (
          <Badge tone={comparison.edge_pts > 0 ? "accent" : comparison.edge_pts < 0 ? "sky" : "neutral"}>
            {edgeLabel(comparison.edge_pts)}
          </Badge>
        )}
      </div>
      <Link
        href={`/q/${comparison.question_id}`}
        className="mt-2 block text-[14px] font-medium leading-snug hover:underline"
      >
        {comparison.prompt}
      </Link>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[20px] font-semibold tracking-tight tabular-nums md:text-[23px]">
        <span>
          Market{" "}
          {comparison.market_pct === null ? (
            "—"
          ) : (
            <AnimatedNumber value={comparison.market_pct} format={(n) => `${Math.round(n)}%`} />
          )}
        </span>
        <span className="text-muted">·</span>
        <span>
          Humans{" "}
          {comparison.crowd_pct === null ? (
            "—"
          ) : (
            <AnimatedNumber value={comparison.crowd_pct} format={(n) => `${Math.round(n)}%`} />
          )}
        </span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
        <span>{comparison.market_ref.label || "Gemini prediction market"}</span>
        {symbol && <span className="font-mono">{symbol}</span>}
        {comparison.live && <span>Live odds</span>}
        <span>{comparison.responses} answers</span>
      </div>
      {latestTrade && <TradeRow trade={latestTrade} />}
    </Card>
  );
}
