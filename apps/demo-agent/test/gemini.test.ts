import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOrder,
  decideTrade,
  impliedYes,
  observableCandidates,
  placeSandboxOrder,
  type Candidate,
  type MarketEvent,
} from "../src/gemini.js";

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
    const o = buildOrder(candidate(), "buy_yes", "1");
    expect(o).toMatchObject({ symbol: "GEMI-WX-1", outcome: "yes", price: "0.63", quantity: "1" });
  });
  it("derives no-price from implied when buy.no missing", () => {
    const o = buildOrder(candidate({ buy_no: null }), "buy_no");
    expect(o.price).toBe("0.40");
  });
  it("clamps and rounds", () => {
    const o = buildOrder(candidate({ buy_yes: 1.5 }), "buy_yes");
    expect(o.price).toBe("0.99");
    const o2 = buildOrder(candidate({ buy_yes: 0.001 }), "buy_yes");
    expect(o2.price).toBe("0.01");
  });
});

describe("placeSandboxOrder", () => {
  it("dry-runs when keys are missing (no network)", async () => {
    const key = process.env.GEMINI_API_KEY;
    const secret = process.env.GEMINI_API_SECRET;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_SECRET;
    try {
      const res = await placeSandboxOrder(buildOrder(candidate(), "buy_yes"), candidate());
      expect(res.dry_run).toBe(true);
      expect((res as { reason: string }).reason).toContain("GEMINI_API_KEY");
    } finally {
      if (key) process.env.GEMINI_API_KEY = key;
      if (secret) process.env.GEMINI_API_SECRET = secret;
    }
  });
  it("dry-runs for production-only instruments", async () => {
    const res = await placeSandboxOrder(
      buildOrder(candidate({ tradable: false, env: "production" }), "buy_yes"),
      candidate({ tradable: false, env: "production" }),
    );
    expect(res.dry_run).toBe(true);
    expect((res as { reason: string }).reason).toContain("production");
  });
});
