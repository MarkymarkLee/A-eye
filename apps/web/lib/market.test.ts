import { CreateQuestionInput } from "@a-eye/shared";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mockedLiveOdds = vi.hoisted(() => vi.fn());
vi.mock("./gemini-odds", () => ({ liveOdds: mockedLiveOdds }));
vi.stubEnv("A_EYE_DB_PATH", ":memory:");
vi.stubEnv("A_EYE_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "a-eye-uploads-")));
vi.stubEnv("S3_BUCKET", "");
vi.stubEnv("XRPL_TREASURY_SEED", "");
vi.stubEnv("XRPL_ISSUER_SEED", "");

const store = await import("./store");
const { latestMarketComparisons, marketComparison } = await import("./market");

const base = {
  lat: 37.8716,
  lng: -122.2536,
  question: "Will BTC be above $80,000?",
  options: ["Yes", "No"],
};

describe("market comparisons", () => {
  it("prefers fresh live odds and leaves the crowd percentage empty without answers", async () => {
    const id = store.createQuestion(
      CreateQuestionInput.parse({
        ...base,
        market_ref: {
          provider: "gemini",
          env: "sandbox",
          event_ticker: "BTC2610112200",
          contract_symbol: "GEMI-BTC2610112200-HI80000",
          label: "$80,000 or above",
          implied_yes: 0.62,
        },
      }),
    );
    mockedLiveOdds.mockResolvedValue({
      implied_yes: 0.7,
      best_bid: 0.69,
      best_ask: 0.71,
      last_trade: 0.7,
      buy_yes: 0.71,
      buy_no: 0.31,
      fetched_at: "2026-10-11T20:00:00.000Z",
    });

    const comparison = await marketComparison(id);

    expect(comparison).toMatchObject({
      question_id: id,
      yes_option: "Yes",
      market_pct: 70,
      asked_market_pct: 62,
      crowd_pct: null,
      responses: 0,
      edge_pts: null,
      live: { implied_yes: 0.7 },
      trades: [],
    });
    await expect(latestMarketComparisons(3)).resolves.toEqual([comparison]);
  });

  it("returns undefined for an unknown question", async () => {
    await expect(marketComparison("missing")).resolves.toBeUndefined();
  });

  it("hides crowd data from market comparisons while results are sealed", async () => {
    const previousEnv = {
      treasury: process.env.A_EYE_TREASURY_ADDRESS,
      unpaid: process.env.ALLOW_UNPAID_QUESTIONS,
      peekPrice: process.env.A_EYE_PEEK_PRICE_USD,
    };
    process.env.A_EYE_TREASURY_ADDRESS = "0x293214291186180810902D97994c2C72fE88255A";
    process.env.ALLOW_UNPAID_QUESTIONS = "0";
    process.env.A_EYE_PEEK_PRICE_USD = "0.02";

    try {
      const id = store.createQuestion(
        CreateQuestionInput.parse({
          ...base,
          market_ref: { provider: "gemini", env: "sandbox", implied_yes: 0.62 },
        }),
      );
      store.getOrCreateObserver("sealed-market-test");
      await store.addSubmission({
        question_id: id,
        observer_id: "sealed-market-test",
        option_index: 0,
        image: { bytes: new TextEncoder().encode(`sealed-${id}`), type: "image/jpeg" },
        lat: 37.8716,
        lng: -122.2536,
        accuracy_m: 5,
        distance_m: 4,
        captured_at: new Date().toISOString(),
      });
      store.recordMarketTrade(id, {
        provider: "gemini",
        env: "sandbox",
        symbol: "GEMI-BTC-TEST",
        side: "buy",
        outcome: "yes",
        quantity: "4",
        price: 0.47,
        status: "filled",
        order_id: "123456789",
        filled_quantity: "4",
        avg_price: 0.47,
        market_pct: 41.5,
        crowd_pct: 100,
        edge_pts: 58.5,
        dry_run: false,
        reason: "crowd more bullish than market by 59 pts",
      });
      mockedLiveOdds.mockResolvedValue(null);

      const comparison = await marketComparison(id);

      expect(comparison).toMatchObject({
        status: "open",
        responses: 1,
        crowd_pct: null,
        edge_pts: null,
        trades: [{ crowd_pct: null, edge_pts: null, reason: null }],
      });
      await expect(store.getResults(id, "http://a-eye.test")).resolves.toMatchObject({
        sealed: true,
        tally: [
          { option: "Yes", count: 0, pct: 0 },
          { option: "No", count: 0, pct: 0 },
        ],
        market_trades: [{ crowd_pct: null, edge_pts: null, reason: null }],
      });
    } finally {
      for (const [key, value] of Object.entries({
        A_EYE_TREASURY_ADDRESS: previousEnv.treasury,
        ALLOW_UNPAID_QUESTIONS: previousEnv.unpaid,
        A_EYE_PEEK_PRICE_USD: previousEnv.peekPrice,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
