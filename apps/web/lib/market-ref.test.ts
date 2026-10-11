import { CreateQuestionInput } from "@a-eye/shared";
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
  it("requires distinct options and a prize of at least one cent", () => {
    expect(CreateQuestionInput.safeParse({ ...base, options: ["Yes", "yes "] }).success).toBe(false);
    expect(CreateQuestionInput.safeParse({ ...base, prize_usd: 0.001 }).success).toBe(false);
    expect(CreateQuestionInput.safeParse({ ...base, prize_usd: 0.01 }).success).toBe(true);
  });

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
});
