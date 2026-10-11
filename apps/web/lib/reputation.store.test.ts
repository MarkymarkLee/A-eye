import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.stubEnv("A_EYE_DB_PATH", ":memory:");
vi.stubEnv("A_EYE_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "a-eye-uploads-")));
vi.stubEnv("NODE_ENV", "production");

// Everything remote (the entropy RPC) is offline; settlement falls back to a
// deterministic seed from closes_at.
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("offline");
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

const store = await import("./store");

describe("observer stats, leaderboard and evidence reputation over the seed data", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("attaches observer_reputation to every getResults evidence item", async () => {
    const results = (await store.getResults("glade-wet", "http://a-eye.test"))!;
    expect(results.status).toBe("settled");
    expect(results.evidence.length).toBeGreaterThan(0);
    for (const ev of results.evidence) {
      expect(ev.observer_reputation.answer_count).toBeGreaterThanOrEqual(1);
      expect(ev.observer_reputation.scored_answers).toBeGreaterThanOrEqual(0);
    }
  });

  it("leaderboard ranks 1..n, leaks no observer ids, and gives Priya her badges", async () => {
    const entries = await store.leaderboard("all");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((e) => e.rank)).toEqual(entries.map((_, i) => i + 1));
    for (const e of entries) {
      expect(e).not.toHaveProperty("observer_id");
      expect(e).not.toHaveProperty("id");
    }
    const priya = entries.find((e) => e.display_name === "Priya Raman")!;
    expect(priya.badges).toEqual(expect.arrayContaining(["first_eyes", "streak_3", "sharpshooter"]));
    expect(priya.agreement_rate).toBe(1);
    expect(priya.best_streak).toBe(5);

    const week = await store.leaderboard("week");
    expect(week.length).toBeGreaterThan(0);
    expect(week.every((e) => e.verified_answers > 0)).toBe(true);
  });

  it("marks the viewer with is_you and nothing else", async () => {
    const entries = await store.leaderboard("all", "seed-obs-0");
    expect(entries.find((e) => e.is_you)?.display_name).toBe("Priya Raman");
    expect(entries.filter((e) => e.is_you)).toHaveLength(1);
  });

  it("observerStats returns zeros for an observer with no answers", async () => {
    const stats = await store.observerStats("nobody-here");
    expect(stats).toMatchObject({ verified_answers: 0, agreement_rate: null, badges: [] });
  });
});
