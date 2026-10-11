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
});
