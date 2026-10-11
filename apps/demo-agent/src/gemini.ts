// Gemini Prediction Markets helpers. Discovery runs against BOTH sandbox and
// production (production is read-only discovery); orders only ever go to
// env "sandbox" — hard-coded, never production.

import { createClient, HmacAuth } from "@gemini-markets/sdk/server";

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
  opts: { env: Env; now?: Date },
): Candidate[] {
  const env = opts.env;
  const out: Candidate[] = [];
  for (const ev of events) {
    for (const c of ev.contracts ?? []) {
      if (!c.strike?.type || !STRIKE_TYPES.has(c.strike.type) || c.strike.value == null) continue;
      if (!c.instrumentSymbol) continue;
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
export async function listObservableMarkets(): Promise<ListingReport> {
  const search = process.env.GEMINI_MARKET_SEARCH ?? "San Francisco";
  const candidates: Candidate[] = [];
  const perEnv: ListingReport["perEnv"] = [];
  for (const env of ["sandbox", "production"] as Env[]) {
    try {
      const client = await createClient({ env, skipWsInit: true });
      const weather = await client.predictions.listEvents({
        status: ["active"],
        category: ["Weather"],
        search,
        limit: 100,
      });
      let events = (weather.data ?? []) as MarketEvent[];
      if (env === "sandbox") {
        const anyCat = await client.predictions.listEvents({
          status: ["active"],
          search,
          limit: 100,
        });
        const seen = new Set(events.map((e) => e.ticker));
        events = events.concat(((anyCat.data ?? []) as MarketEvent[]).filter((e) => !seen.has(e.ticker)));
      }
      perEnv.push({ env, events: events.length });
      candidates.push(...observableCandidates(events, { env, now: new Date() }));
    } catch (err) {
      perEnv.push({ env, events: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // Re-sort the merged list.
  candidates.sort((a, b) => {
    if (a.tradable !== b.tradable) return a.tradable ? -1 : 1;
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

export type OrderSpec = {
  symbol: string;
  orderType: "limit";
  side: "buy";
  outcome: "yes" | "no";
  quantity: string;
  price: string;
  makerOrCancel: false;
};

export function buildOrder(
  candidate: Candidate,
  action: "buy_yes" | "buy_no",
  qty = process.env.GEMINI_ORDER_QTY ?? "1",
): OrderSpec {
  let price: number | null;
  if (action === "buy_yes") price = candidate.buy_yes ?? candidate.implied_yes;
  else price = candidate.buy_no ?? (candidate.implied_yes != null ? 1 - candidate.implied_yes : null);
  let p = price ?? 0.5;
  p = Math.round(p * 100) / 100;
  p = Math.min(0.99, Math.max(0.01, p));
  return {
    symbol: candidate.contract_symbol,
    orderType: "limit",
    side: "buy",
    outcome: action === "buy_yes" ? "yes" : "no",
    quantity: qty,
    price: p.toFixed(2),
    makerOrCancel: false,
  };
}

export type OrderResult =
  | { dry_run: true; reason: string; order: OrderSpec }
  | { dry_run: false; order_id?: string; order: OrderSpec; raw: unknown };

export async function placeSandboxOrder(
  order: OrderSpec,
  candidate: Candidate,
  opts: { dryRun?: boolean } = {},
): Promise<OrderResult> {
  const missing: string[] = [];
  if (!process.env.GEMINI_API_KEY) missing.push("GEMINI_API_KEY");
  if (!process.env.GEMINI_API_SECRET) missing.push("GEMINI_API_SECRET");
  if (!candidate.tradable) {
    return {
      dry_run: true,
      reason: "instrument only listed on production; sandbox has no Weather markets",
      order,
    };
  }
  if (missing.length > 0) {
    return { dry_run: true, reason: `missing ${missing.join(" and ")}`, order };
  }
  if (opts.dryRun) {
    return { dry_run: true, reason: "--dry-run flag", order };
  }
  const client = await createClient({
    env: "sandbox",
    auth: new HmacAuth({
      apiKey: process.env.GEMINI_API_KEY!,
      apiSecret: process.env.GEMINI_API_SECRET!,
    }),
    skipWsInit: true,
  });
  const terms = await client.predictions.getPredictionMarketsTermsStatus();
  if (terms.hasAcceptedLatest === false) {
    await client.predictions.acceptPredictionMarketsTerms();
  }
  const resp = await client.predictions.placeOrder(order);
  const raw = resp as unknown as Record<string, unknown>;
  return { dry_run: false, order_id: (raw.orderId ?? raw.id) as string | undefined, order, raw };
}
