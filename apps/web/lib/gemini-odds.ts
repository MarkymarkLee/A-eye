import type { LiveMarketOdds, MarketRef } from "@a-eye/shared";

const cache = new Map<string, { expiresAt: number; value: LiveMarketOdds | null }>();
const CACHE_MS = 10_000;
const TIMEOUT_MS = 4_000;

function numeric(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function liveOdds(
  marketRef: MarketRef | undefined,
  opts: { fetcher?: typeof fetch; now?: () => number } = {},
): Promise<LiveMarketOdds | null> {
  if (
    marketRef?.provider !== "gemini" ||
    !marketRef.event_ticker ||
    !marketRef.contract_symbol
  ) {
    return null;
  }

  const now = opts.now ?? Date.now;
  const env = marketRef.env === "production" ? "production" : "sandbox";
  const key = `${env}:${marketRef.contract_symbol}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now()) return cached.value;

  const base = env === "production" ? "https://api.gemini.com" : "https://api.sandbox.gemini.com";
  try {
    const response = await (opts.fetcher ?? fetch)(
      `${base}/v1/prediction-markets/events/${encodeURIComponent(marketRef.event_ticker)}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!response.ok) throw new Error(`Gemini public API returned ${response.status}`);
    const event = (await response.json()) as {
      contracts?: Array<{
        instrumentSymbol?: string;
        prices?: {
          bestBid?: unknown;
          bestAsk?: unknown;
          lastTradePrice?: unknown;
          buy?: { yes?: unknown; no?: unknown };
        };
      }>;
    };
    const contract = event.contracts?.find((item) => item.instrumentSymbol === marketRef.contract_symbol);
    if (!contract?.prices) throw new Error("Gemini contract not found");
    const bestBid = numeric(contract.prices.bestBid);
    const bestAsk = numeric(contract.prices.bestAsk);
    const lastTrade = numeric(contract.prices.lastTradePrice);
    const buyYes = numeric(contract.prices.buy?.yes);
    const buyNo = numeric(contract.prices.buy?.no);
    const impliedYes =
      bestBid !== null && bestAsk !== null
        ? (bestBid + bestAsk) / 2
        : lastTrade ?? buyYes;
    const value =
      impliedYes === null
        ? null
        : {
            implied_yes: impliedYes,
            best_bid: bestBid,
            best_ask: bestAsk,
            last_trade: lastTrade,
            buy_yes: buyYes,
            buy_no: buyNo,
            fetched_at: new Date(now()).toISOString(),
          };
    cache.set(key, { expiresAt: now() + CACHE_MS, value });
    return value;
  } catch {
    cache.set(key, { expiresAt: now() + CACHE_MS, value: null });
    return null;
  }
}

export function clearLiveOddsCache() {
  cache.clear();
}
