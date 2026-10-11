import { describe, expect, it, vi } from "vitest";
import { clearLiveOddsCache, liveOdds } from "./gemini-odds";

const marketRef = {
  provider: "gemini",
  env: "sandbox" as const,
  event_ticker: "SOL2610112200",
  contract_symbol: "GEMI-SOL2610112200-HI107",
};

describe("live Gemini odds", () => {
  it("finds the referenced contract and derives implied odds from the bid/ask midpoint", async () => {
    clearLiveOddsCache();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          contracts: [
            {
              instrumentSymbol: marketRef.contract_symbol,
              prices: {
                bestBid: "0.89",
                bestAsk: "0.97",
                lastTradePrice: "0.92",
                buy: { yes: "0.97", no: "0.11" },
              },
            },
          ],
        }),
      ),
    );
    const odds = await liveOdds(marketRef, { fetcher, now: () => 1_800_000_000_000 });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.sandbox.gemini.com/v1/prediction-markets/events/SOL2610112200",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(odds).toMatchObject({
      implied_yes: 0.9299999999999999,
      best_bid: 0.89,
      best_ask: 0.97,
      last_trade: 0.92,
      buy_yes: 0.97,
      buy_no: 0.11,
    });
  });

  it("uses the production public endpoint and caches odds for ten seconds by symbol", async () => {
    clearLiveOddsCache();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          contracts: [
            {
              instrumentSymbol: marketRef.contract_symbol,
              prices: { lastTradePrice: "0.7", buy: { yes: "0.68", no: "0.34" } },
            },
          ],
        }),
      ),
    );
    const productionRef = { ...marketRef, env: "production" as const };
    const first = await liveOdds(productionRef, { fetcher, now: () => 10_000 });
    const second = await liveOdds(productionRef, { fetcher, now: () => 10_001 });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.gemini.com/v1/prediction-markets/events/SOL2610112200",
    );
    expect(first?.implied_yes).toBe(0.7);
    expect(second).toEqual(first);
  });

  it("returns null for non-Gemini providers and failed public requests", async () => {
    await expect(liveOdds({ ...marketRef, provider: "other" })).resolves.toBeNull();
    await expect(
      liveOdds(marketRef, { fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")) }),
    ).resolves.toBeNull();
  });
});
