// Gemini Prediction Markets helpers. Discovery runs against BOTH sandbox and
// production (production is read-only discovery); orders only ever go to
// env "sandbox" — hard-coded, never production.

import { createClient } from "@gemini-markets/sdk/server";
import { GeminiRestClient, type GeminiOrder, type OrderSpec } from "./gemini-rest.js";

export { parseGeminiJson } from "./gemini-rest.js";
export type { OrderSpec } from "./gemini-rest.js";

export type Env = "sandbox" | "production";
export const ORDER_ENV: Env = "sandbox";

type Strike = { type?: string | null; value?: string | null } | undefined;
type Prices =
  | {
      buy?: { yes?: string; no?: string };
      sell?: { yes?: string; no?: string };
      bestBid?: string | null;
      bestAsk?: string | null;
      lastTradePrice?: string | null;
    }
  | null
  | undefined;

export type MarketEvent = {
  ticker?: string;
  title?: string;
  category?: string;
  expiryDate?: string | null;
  contracts?: {
    label?: string;
    instrumentSymbol?: string;
    strike?: Strike;
    prices?: Prices;
  }[];
};

export type Candidate = {
  env: Env;
  tradable: boolean;
  event_ticker: string;
  event_title: string;
  contract_symbol: string;
  label: string;
  strike: { type: string; value: string };
  implied_yes: number | null;
  buy_yes: number | null;
  buy_no: number | null;
  expiry: string | null;
};

const num = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Implied YES probability: mid of bid/ask, else last trade, else buy.yes. */
export function impliedYes(prices: Prices): number | null {
  if (!prices) return null;
  const bid = num(prices.bestBid);
  const ask = num(prices.bestAsk);
  if (bid != null && ask != null) return (bid + ask) / 2;
  const last = num(prices.lastTradePrice);
  if (last != null) return last;
  return num(prices.buy?.yes);
}

const STRIKE_TYPES = new Set(["above", "below"]);

export function observableCandidates(
  events: MarketEvent[],
  opts: { env: Env; now?: Date; minExpiryMinutes?: number },
): Candidate[] {
  const env = opts.env;
  const expiryCutoff = (opts.now?.getTime() ?? Date.now()) + (opts.minExpiryMinutes ?? 0) * 60_000;
  const out: Candidate[] = [];
  for (const ev of events) {
    for (const c of ev.contracts ?? []) {
      if (!c.strike?.type || !STRIKE_TYPES.has(c.strike.type) || c.strike.value == null) continue;
      if (!c.instrumentSymbol) continue;
      if (ev.expiryDate && Date.parse(ev.expiryDate) < expiryCutoff) continue;
      out.push({
        env,
        tradable: env === "sandbox",
        event_ticker: ev.ticker ?? "",
        event_title: ev.title ?? "",
        contract_symbol: c.instrumentSymbol,
        label: c.label ?? "",
        strike: { type: c.strike.type, value: c.strike.value },
        implied_yes: impliedYes(c.prices),
        buy_yes: num(c.prices?.buy?.yes),
        buy_no: num(c.prices?.buy?.no),
        expiry: c.instrumentSymbol ? ev.expiryDate ?? null : null,
      });
    }
  }
  const expiryOf = (c: Candidate) => (c.expiry ? Date.parse(c.expiry) : Number.POSITIVE_INFINITY);
  out.sort((a, b) => {
    if (a.tradable !== b.tradable) return a.tradable ? -1 : 1;
    const at = a.buy_yes != null && a.buy_no != null;
    const bt = b.buy_yes != null && b.buy_no != null;
    if (at !== bt) return at ? -1 : 1;
    const ap = a.implied_yes != null;
    const bp = b.implied_yes != null;
    if (ap !== bp) return ap ? -1 : 1;
    const ad = Math.abs((a.implied_yes ?? 0.5) - 0.5);
    const bd = Math.abs((b.implied_yes ?? 0.5) - 0.5);
    if (ad !== bd) return ad - bd;
    return expiryOf(a) - expiryOf(b);
  });
  return out;
}

export type ListingReport = {
  candidates: Candidate[];
  perEnv: { env: Env; events: number; error?: string }[];
};

/**
 * Public (unauthenticated) listing on both envs: Weather + the search term,
 * plus sandbox events matching the search in ANY category (sandbox has no
 * Weather right now).
 */
export async function listObservableMarkets(opts: { questionMinutes?: number; now?: Date } = {}): Promise<ListingReport> {
  const search = process.env.GEMINI_MARKET_SEARCH ?? "San Francisco";
  const now = opts.now ?? new Date();
  const minExpiryMinutes = (opts.questionMinutes ?? 10) + 5;
  const candidates: Candidate[] = [];
  const perEnv: ListingReport["perEnv"] = [];
  for (const env of ["sandbox", "production"] as Env[]) {
    try {
      const client = await createClient({ env, skipWsInit: true });
      const weather = await client.predictions.listEvents({
        status: ["active"],
        category: ["Weather"],
        ...(env === "production" ? { search } : {}),
        limit: 100,
      });
      let events = (weather.data ?? []) as MarketEvent[];
      if (env === "sandbox") {
        const anyCat = await client.predictions.listEvents({
          status: ["active"],
          limit: 100,
        });
        const merged = new Map<string, MarketEvent>();
        for (const event of [...events, ...((anyCat.data ?? []) as MarketEvent[])]) {
          merged.set(event.ticker ?? JSON.stringify(event), event);
        }
        events = [...merged.values()];
      }
      perEnv.push({ env, events: events.length });
      candidates.push(...observableCandidates(events, { env, now, minExpiryMinutes }));
    } catch (err) {
      perEnv.push({ env, events: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // Re-sort the merged list.
  candidates.sort((a, b) => {
    if (a.tradable !== b.tradable) return a.tradable ? -1 : 1;
    const at = a.buy_yes != null && a.buy_no != null;
    const bt = b.buy_yes != null && b.buy_no != null;
    if (at !== bt) return at ? -1 : 1;
    const ap = a.implied_yes != null;
    const bp = b.implied_yes != null;
    if (ap !== bp) return ap ? -1 : 1;
    const ad = Math.abs((a.implied_yes ?? 0.5) - 0.5);
    const bd = Math.abs((b.implied_yes ?? 0.5) - 0.5);
    if (ad !== bd) return ad - bd;
    const ae = a.expiry ? Date.parse(a.expiry) : Number.POSITIVE_INFINITY;
    const be = b.expiry ? Date.parse(b.expiry) : Number.POSITIVE_INFINITY;
    return ae - be;
  });
  return { candidates, perEnv };
}

export type TradeDecision = {
  action: "buy_yes" | "buy_no" | "none";
  divergence_pts: number;
  reason: string;
};

export function decideTrade(input: {
  crowdYesPct: number;
  responses: number;
  impliedYes: number | null;
  thresholdPts?: number;
  minResponses?: number;
}): TradeDecision {
  const threshold = input.thresholdPts ?? Number(process.env.ORACLE_DIVERGENCE_PTS ?? 15);
  const minResponses = input.minResponses ?? Number(process.env.ORACLE_MIN_RESPONSES ?? 3);
  if (input.impliedYes == null) {
    return { action: "none", divergence_pts: 0, reason: "no market odds (implied YES unavailable)" };
  }
  if (input.responses < minResponses) {
    return {
      action: "none",
      divergence_pts: 0,
      reason: `not enough human responses (${input.responses} < ${minResponses})`,
    };
  }
  const marketPct = input.impliedYes * 100;
  const divergence = input.crowdYesPct - marketPct;
  const abs = Math.abs(divergence);
  if (abs <= threshold) {
    return {
      action: "none",
      divergence_pts: divergence,
      reason: `|${divergence.toFixed(0)} pts| <= ${threshold} threshold`,
    };
  }
  return {
    action: divergence > 0 ? "buy_yes" : "buy_no",
    divergence_pts: divergence,
    reason: `crowd ${divergence > 0 ? "more" : "less"} bullish than market by ${abs.toFixed(0)} pts`,
  };
}

export type SizeTradeInput = {
  crowdYesPct: number;
  responses: number;
  impliedYes: number | null;
  buyYes?: number | null;
  buyNo?: number | null;
  thresholdPts?: number;
  minResponses?: number;
  priorWeight?: number;
  minEdge?: number;
  bankrollUsd?: number;
  kellyFraction?: number;
  maxContracts?: number;
  maxNotionalUsd?: number;
  fixedQty?: number | string;
};

export type SizedTrade = {
  action: "buy_yes" | "buy_no" | "none";
  divergence_pts: number;
  fair_yes: number | null;
  edge: number | null;
  limit_price?: string;
  quantity?: string;
  notional?: number;
  kelly?: number;
  reason: string;
};

const envNumber = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function sizeTrade(input: SizeTradeInput): SizedTrade {
  const decision = decideTrade({
    crowdYesPct: input.crowdYesPct,
    responses: input.responses,
    impliedYes: input.impliedYes,
    thresholdPts: input.thresholdPts,
    minResponses: input.minResponses,
  });
  if (decision.action === "none" || input.impliedYes == null) {
    return { action: "none", divergence_pts: decision.divergence_pts, fair_yes: null, edge: null, reason: decision.reason };
  }
  const priorWeight = input.priorWeight ?? envNumber("ORACLE_PRIOR_WEIGHT", 5);
  const weight = input.responses / (input.responses + priorWeight);
  const fairYes = weight * (input.crowdYesPct / 100) + (1 - weight) * input.impliedYes;
  const buyYes = input.buyYes ?? input.impliedYes;
  const buyNo = input.buyNo ?? 1 - input.impliedYes;
  const ask = decision.action === "buy_yes" ? buyYes : buyNo;
  const fair = decision.action === "buy_yes" ? fairYes : 1 - fairYes;
  const edge = Number((fair - ask).toFixed(12));
  const minEdge = input.minEdge ?? envNumber("ORACLE_MIN_EDGE", 0.03);
  if (edge < minEdge) {
    return {
      action: "none",
      divergence_pts: decision.divergence_pts,
      fair_yes: fairYes,
      edge,
      reason: `edge ${edge.toFixed(4)} < min edge ${minEdge.toFixed(4)}`,
    };
  }
  const limit = clamp(Math.round(ask * 100) / 100, 0.01, 0.99);
  const bankroll = input.bankrollUsd ?? envNumber("ORACLE_BANKROLL_USD", 20);
  const kellyFraction = input.kellyFraction ?? envNumber("ORACLE_KELLY_FRACTION", 0.25);
  const requestedMaxContracts = input.maxContracts ?? envNumber("ORACLE_MAX_CONTRACTS", 10);
  const requestedMaxNotional = input.maxNotionalUsd ?? envNumber("ORACLE_MAX_NOTIONAL_USD", 5);
  const maxContracts = clamp(Math.floor(requestedMaxContracts), 1, 50);
  const maxNotional = clamp(requestedMaxNotional, 0, 25);
  const kelly = Math.max(0, (fair - limit) / (1 - limit));
  const stake = bankroll * kellyFraction * kelly;
  const calculatedQty = Math.floor(Math.min(stake, maxNotional) / limit);
  const fixedQty = input.fixedQty ?? process.env.GEMINI_ORDER_QTY;
  const initialQty = fixedQty == null ? calculatedQty : Number(fixedQty);
  const quantity = Math.max(1, Math.min(Math.floor(initialQty), maxContracts, Math.floor(maxNotional / limit)));
  return {
    action: decision.action,
    divergence_pts: decision.divergence_pts,
    fair_yes: fairYes,
    edge,
    limit_price: limit.toFixed(2),
    quantity: String(quantity),
    notional: Math.round(quantity * limit * 100) / 100,
    kelly,
    reason: decision.reason,
  };
}

export function buildOrder(
  candidate: Candidate,
  sizing: SizedTrade,
): OrderSpec {
  if (sizing.action === "none" || sizing.quantity == null || sizing.limit_price == null) {
    throw new Error("Cannot build an order from a no-trade sizing result.");
  }
  return {
    symbol: candidate.contract_symbol,
    orderType: "limit",
    side: "buy",
    outcome: sizing.action === "buy_yes" ? "yes" : "no",
    quantity: sizing.quantity,
    price: sizing.limit_price,
    timeInForce: "good-til-cancel",
    makerOrCancel: false,
  };
}

export type SandboxTradeResult = {
  dry_run: boolean;
  reason?: string;
  order_id?: string;
  hash_order_id?: string;
  status?: "filled" | "partially_filled" | "cancelled" | "open" | "rejected";
  filled_quantity?: string;
  avg_price?: string | null;
  cancelled_remainder?: boolean;
  position?: unknown | null;
  order?: GeminiOrder | OrderSpec;
};

export async function executeSandboxTrade(
  spec: OrderSpec,
  candidate: Candidate,
  opts: { dryRun?: boolean; fillWaitS?: number; client?: GeminiRestClient; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SandboxTradeResult> {
  const missing: string[] = [];
  if (!process.env.GEMINI_API_KEY) missing.push("GEMINI_API_KEY");
  if (!process.env.GEMINI_API_SECRET) missing.push("GEMINI_API_SECRET");
  if (!candidate.tradable) {
    return { dry_run: true, reason: "instrument is not tradable in the Gemini sandbox", order: spec };
  }
  if (missing.length > 0) {
    return { dry_run: true, reason: `missing ${missing.join(" and ")}`, order: spec };
  }
  if (opts.dryRun) {
    return { dry_run: true, reason: "--dry-run flag", order: spec };
  }
  const client = opts.client ?? new GeminiRestClient();
  const pause = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const fillWaitS = opts.fillWaitS ?? envNumber("ORACLE_FILL_WAIT_S", 10);
  const placed = await client.placeOrder(spec);
  const orderId = idOf(placed);
  let latest = placed;
  let active = orderStatus(placed) === "open";
  const deadline = Date.now() + Math.max(0, fillWaitS) * 1000;
  while (active && Date.now() < deadline) {
    await pause(Math.min(2000, Math.max(0, deadline - Date.now())));
    const orders = await client.activeOrders(spec.symbol);
    const current = orders.find((order) => idOf(order) === orderId);
    if (current) latest = current;
    else {
      const history = await client.orderHistory(spec.symbol);
      const historic = history.find((order) => idOf(order) === orderId);
      if (historic) latest = historic;
    }
    active = orderStatus(latest) === "open";
  }
  let cancelledRemainder = false;
  if (active && Number(latest.remainingQuantity ?? spec.quantity) > 0 && orderId) {
    await client.cancelOrder(orderId);
    cancelledRemainder = true;
  }
  const history = await client.orderHistory(spec.symbol);
  latest = history.find((order) => idOf(order) === orderId) ?? latest;
  const positions = await client.positions();
  const position = findPosition(positions, spec.symbol);
  const filled = String(latest.filledQuantity ?? "0");
  const status = normalizeStatus(latest, cancelledRemainder);
  return {
    dry_run: false,
    order_id: orderId,
    hash_order_id: stringValue(latest.hashOrderId),
    status,
    filled_quantity: filled,
    avg_price: stringValue(latest.avgExecutionPrice ?? latest.avgPrice),
    cancelled_remainder: cancelledRemainder,
    position,
    order: latest,
  };
}

function stringValue(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

function idOf(order: GeminiOrder): string | undefined {
  return stringValue(order.orderId ?? order.id);
}

function orderStatus(order: GeminiOrder): string {
  return String(order.status ?? "").toLowerCase();
}

function normalizeStatus(order: GeminiOrder, cancelled: boolean): NonNullable<SandboxTradeResult["status"]> {
  const filled = Number(order.filledQuantity ?? 0);
  const remaining = Number(order.remainingQuantity ?? 0);
  const status = orderStatus(order);
  if (status === "rejected") return "rejected";
  if (cancelled) return filled > 0 ? "partially_filled" : "cancelled";
  if ((status === "filled" || remaining === 0) && filled > 0) return "filled";
  if (filled > 0 && remaining > 0) return "partially_filled";
  return "open";
}

function findPosition(positions: unknown, symbol: string): unknown | null {
  const rows = Array.isArray(positions)
    ? positions
    : positions && typeof positions === "object" && Array.isArray((positions as Record<string, unknown>).positions)
      ? (positions as { positions: unknown[] }).positions
      : [];
  return rows.find((row) => row && typeof row === "object" && (row as Record<string, unknown>).symbol === symbol) ?? null;
}
