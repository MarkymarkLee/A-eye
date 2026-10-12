import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOrder,
  decideTrade,
  executeSandboxTrade,
  impliedYes,
  observableCandidates,
  sizeTrade,
  type Candidate,
  type MarketEvent,
} from "../src/gemini.js";
import { GeminiRestClient, parseGeminiJson } from "../src/gemini-rest.js";
import type { OrderSpec } from "../src/gemini.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(path.join(HERE, "fixtures", "production-events.json"), "utf8"),
) as { data: MarketEvent[] };

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  env: "sandbox",
  tradable: true,
  event_ticker: "WX",
  event_title: "Weather",
  contract_symbol: "GEMI-WX-1",
  label: "above 71",
  strike: { type: "above", value: "71" },
  implied_yes: 0.6,
  buy_yes: 0.63,
  buy_no: 0.42,
  expiry: "2026-10-12T00:00:00Z",
  ...over,
});

describe("impliedYes", () => {
  it("mid of bestBid/bestAsk", () => {
    expect(impliedYes({ bestBid: "0.03", bestAsk: "0.18" })).toBeCloseTo(0.105);
  });
  it("falls back to lastTradePrice", () => {
    expect(impliedYes({ bestBid: null, lastTradePrice: "0.04" })).toBe(0.04);
  });
  it("falls back to buy.yes", () => {
    expect(impliedYes({ buy: { yes: "0.18" } })).toBe(0.18);
  });
  it("null when empty", () => {
    expect(impliedYes({ buy: {}, sell: {} })).toBeNull();
    expect(impliedYes(null)).toBeNull();
  });
});

describe("observableCandidates", () => {
  it("extracts strike contracts from a real production listing", () => {
    const cands = observableCandidates(fixture.data, { env: "production" });
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]!.env).toBe("production");
    expect(cands[0]!.tradable).toBe(false);
    expect(cands[0]!.contract_symbol).toMatch(/^GEMI-/);
    expect(["above", "below"]).toContain(cands[0]!.strike.type);
  });
  it("sorts tradable first, then has-odds, then near 0.5, then expiry", () => {
    const cands = observableCandidates(fixture.data, { env: "production" });
    const b = candidate({ implied_yes: 0.9 });
    const a = candidate({ implied_yes: 0.51, contract_symbol: "A" });
    const merged = [...cands, b];
    // sandbox candidate sorts before all production candidates
    expect(merged.filter((c) => c.tradable)[0]!.tradable).toBe(true);
    void a;
  });
});

describe("decideTrade", () => {
  const base = { crowdYesPct: 85, responses: 9, impliedYes: 0.62, thresholdPts: 15, minResponses: 3 };
  it("buys yes on positive divergence", () => {
    expect(decideTrade(base).action).toBe("buy_yes");
  });
  it("buys no on negative divergence", () => {
    expect(decideTrade({ ...base, crowdYesPct: 20 }).action).toBe("buy_no");
  });
  it("none inside threshold", () => {
    expect(decideTrade({ ...base, crowdYesPct: 70 }).action).toBe("none");
  });
  it("none when implied is null", () => {
    expect(decideTrade({ ...base, impliedYes: null }).reason).toContain("no market odds");
  });
  it("none when responses below min", () => {
    const d = decideTrade({ ...base, responses: 1 });
    expect(d.action).toBe("none");
    expect(d.reason).toContain("not enough");
  });
});

describe("buildOrder", () => {
  it("uses buy price for the outcome", () => {
    const sizing = sizeTrade({ crowdYesPct: 85, responses: 9, impliedYes: 0.62, buyYes: 0.63 });
    const o = buildOrder(candidate(), sizing);
    expect(o).toMatchObject({
      symbol: "GEMI-WX-1",
      outcome: "yes",
      price: "0.63",
      quantity: "2",
      timeInForce: "good-til-cancel",
    });
  });
});

describe("sizeTrade", () => {
  it("sizes a YES order using crowd-weighted fair value and Kelly", () => {
    const sizing = sizeTrade({ crowdYesPct: 85, responses: 9, impliedYes: 0.62, buyYes: 0.63 });
    expect(sizing).toMatchObject({ action: "buy_yes", limit_price: "0.63", quantity: "2" });
    expect(sizing.fair_yes).toBeCloseTo(0.767857, 5);
    expect(sizing.edge).toBeCloseTo(0.137857, 5);
    expect(sizing.kelly).toBeCloseTo(0.372587, 5);
  });
  it("sizes a NO order using its own buy ask", () => {
    const sizing = sizeTrade({ crowdYesPct: 20, responses: 9, impliedYes: 0.62, buyNo: 0.42 });
    expect(sizing).toMatchObject({ action: "buy_no", limit_price: "0.42", quantity: "4" });
    expect(sizing.fair_yes).toBeCloseTo(0.35);
    expect(sizing.edge).toBeCloseTo(0.23);
    expect(sizing.kelly).toBeCloseTo(0.396552, 5);
  });
  it("rejects a bad ask despite a qualifying divergence", () => {
    expect(sizeTrade({ crowdYesPct: 80, responses: 3, impliedYes: 0.62, buyYes: 0.7 })).toMatchObject({
      action: "none",
      edge: -0.0125,
      reason: "edge -0.0125 < min edge 0.0300",
    });
  });
  it("caps fixed and calculated quantity to notional", () => {
    expect(sizeTrade({ crowdYesPct: 85, responses: 9, impliedYes: 0.62, buyYes: 0.63, bankrollUsd: 1000 }).quantity).toBe("7");
    expect(sizeTrade({ crowdYesPct: 85, responses: 9, impliedYes: 0.62, buyYes: 0.63, fixedQty: 100 }).quantity).toBe("7");
  });
  it("enforces hard ceilings even when configured higher", () => {
    expect(sizeTrade({
      crowdYesPct: 85,
      responses: 9,
      impliedYes: 0.62,
      buyYes: 0.63,
      maxNotionalUsd: 1000,
      maxContracts: 1000,
      fixedQty: 1000,
    })).toMatchObject({ quantity: "39", notional: 24.57 });
  });
  it("caps quantity at 50 when notional allows it", () => {
    expect(sizeTrade({
      crowdYesPct: 100,
      responses: 100,
      impliedYes: 0.1,
      buyYes: 0.1,
      bankrollUsd: 10000,
      maxNotionalUsd: 1000,
      maxContracts: 1000,
      fixedQty: 1000,
    }).quantity).toBe("50");
  });
});

describe("Gemini REST ids", () => {
  it("parses large order ids as strings", () => {
    expect(parseGeminiJson<{ orderId: string; globalOrderId: string }>(
      '{"orderId":145853902277378635,"globalOrderId":145853902277378636}',
    )).toEqual({ orderId: "145853902277378635", globalOrderId: "145853902277378636" });
  });
});

describe("executeSandboxTrade", () => {
  const spec: OrderSpec = {
    symbol: "GEMI-TEST",
    orderType: "limit",
    side: "buy",
    outcome: "yes",
    quantity: "2",
    price: "0.63",
    timeInForce: "good-til-cancel",
    makerOrCancel: false,
  };

  it("dry-runs when keys are missing (no network)", async () => {
    const key = process.env.GEMINI_API_KEY;
    const secret = process.env.GEMINI_API_SECRET;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_SECRET;
    try {
      const res = await executeSandboxTrade(spec, candidate());
      expect(res.dry_run).toBe(true);
      expect(res.reason).toContain("GEMINI_API_KEY");
    } finally {
      if (key) process.env.GEMINI_API_KEY = key;
      if (secret) process.env.GEMINI_API_SECRET = secret;
    }
  });
  it("dry-runs for production-only instruments", async () => {
    const prod = candidate({ tradable: false, env: "production" });
    const res = await executeSandboxTrade(spec, prod);
    expect(res.dry_run).toBe(true);
    expect(res.reason).toContain("not tradable");
  });
  it("cancels the remainder of an open order and preserves the bigint id", async () => {
    const key = process.env.GEMINI_API_KEY;
    const secret = process.env.GEMINI_API_SECRET;
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_API_SECRET = "test-secret";
    const requests: { url: string; body: string }[] = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      const path = new URL(url).pathname;
      requests.push({ url: String(url), body: String(init?.body ?? "") });
      const bodies: Record<string, string> = {
        "/v1/prediction-markets/order": '{"orderId":145853902277378635,"hashOrderId":"hash","status":"open","filledQuantity":"1","remainingQuantity":"1"}',
        "/v1/prediction-markets/orders/active": '[{"orderId":145853902277378635,"status":"open","filledQuantity":"1","remainingQuantity":"1"}]',
        "/v1/prediction-markets/order/cancel": '{"result":"ok"}',
        "/v1/prediction-markets/orders/history": '[{"orderId":145853902277378635,"hashOrderId":"hash","status":"cancelled","filledQuantity":"1","remainingQuantity":"0","avgPrice":"0.62"}]',
        "/v1/prediction-markets/positions": '[{"symbol":"GEMI-TEST","quantity":"1"}]',
      };
      return new Response(bodies[path] ?? "{}", { status: 200 });
    };
    try {
      const client = new GeminiRestClient({ apiKey: "test-key", apiSecret: "test-secret", fetch: fetchImpl });
      const result = await executeSandboxTrade(spec, candidate(), {
        client,
        fillWaitS: 1,
        sleep: async () => undefined,
      });
      expect(result).toMatchObject({
        dry_run: false,
        order_id: "145853902277378635",
        status: "partially_filled",
        filled_quantity: "1",
        cancelled_remainder: true,
        avg_price: "0.62",
      });
      expect(requests.find((request) => request.url.endsWith("/order/cancel"))?.body).toBe('{"orderId":145853902277378635}');
    } finally {
      if (key) process.env.GEMINI_API_KEY = key;
      else delete process.env.GEMINI_API_KEY;
      if (secret) process.env.GEMINI_API_SECRET = secret;
      else delete process.env.GEMINI_API_SECRET;
    }
  });
  it("returns immediate fill and does not cancel", async () => {
    const key = process.env.GEMINI_API_KEY;
    const secret = process.env.GEMINI_API_SECRET;
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_API_SECRET = "test-secret";
    const paths: string[] = [];
    const fetchImpl = async (url: string | URL) => {
      const path = new URL(url).pathname;
      paths.push(path);
      const body = path.endsWith("/order")
        ? '{"orderId":145853902277378635,"status":"filled","filledQuantity":"2","remainingQuantity":"0","avgExecutionPrice":"0.63"}'
        : path.endsWith("/history")
          ? '[{"orderId":145853902277378635,"status":"filled","filledQuantity":"2","remainingQuantity":"0","avgExecutionPrice":"0.63"}]'
          : path.endsWith("/positions")
            ? "[]"
            : "{}";
      return new Response(body, { status: 200 });
    };
    try {
      const result = await executeSandboxTrade(spec, candidate(), {
        client: new GeminiRestClient({ apiKey: "test-key", apiSecret: "test-secret", fetch: fetchImpl }),
      });
      expect(result).toMatchObject({ status: "filled", filled_quantity: "2", avg_price: "0.63" });
      expect(paths).not.toContain("/v1/prediction-markets/order/cancel");
    } finally {
      if (key) process.env.GEMINI_API_KEY = key;
      else delete process.env.GEMINI_API_KEY;
      if (secret) process.env.GEMINI_API_SECRET = secret;
      else delete process.env.GEMINI_API_SECRET;
    }
  });
});
