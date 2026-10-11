import { CreateQuestionInput, RecordMarketTradeInput } from "@a-eye/shared";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("A_EYE_DB_PATH", ":memory:");
vi.stubEnv("A_EYE_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "a-eye-uploads-")));

const store = await import("./store");

const base = {
  lat: 37.8716,
  lng: -122.2536,
  question: "Is it raining at Chou Hall?",
  options: ["Yes", "No"],
};

describe("market_ref", () => {
  it("round-trips through the store", async () => {
    const market_ref = { provider: "gemini-predictions", env: "sandbox" as const, event_ticker: "GEMI-WXHIGH-SFO" };
    const id = store.createQuestion(CreateQuestionInput.parse({ ...base, market_ref }));
    const results = await store.getResults(id, "http://localhost");
    expect(results?.market_ref).toMatchObject(market_ref);
  });

  it("is omitted when not provided", async () => {
    const id = store.createQuestion(CreateQuestionInput.parse(base));
    expect((await store.getResults(id, "http://localhost"))?.market_ref).toBeUndefined();
  });

  it("upserts sandbox trades by question and order id and includes them in results", async () => {
    const id = store.createQuestion(
      CreateQuestionInput.parse({
        ...base,
        market_ref: {
          provider: "gemini",
          env: "sandbox",
          event_ticker: "SOL2610112200",
          contract_symbol: "GEMI-SOL2610112200-HI107",
          implied_yes: 0.62,
        },
      }),
    );
    const trade = RecordMarketTradeInput.parse({
      provider: "gemini",
      env: "sandbox",
      symbol: "GEMI-SOL2610112200-HI107",
      side: "buy",
      outcome: "yes",
      quantity: "2",
      price: 0.63,
      status: "open",
      order_id: "145853902277378635",
      filled_quantity: "0",
      avg_price: null,
      market_pct: 62,
      crowd_pct: 85,
      edge_pts: 23,
      dry_run: false,
      reason: null,
    });
    const first = store.recordMarketTrade(id, trade);
    const updated = store.recordMarketTrade(id, { ...trade, status: "filled", filled_quantity: "2" });
    const results = await store.getResults(id, "http://localhost");

    expect(updated.id).toBe(first.id);
    expect(updated.status).toBe("filled");
    expect(results?.market_trades).toHaveLength(1);
    expect(results?.market_trades?.[0]).toMatchObject({
      order_id: "145853902277378635",
      dry_run: false,
      status: "filled",
      filled_quantity: "2",
    });
  });
});
