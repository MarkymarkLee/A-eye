import { mkdtempSync } from "node:fs";
import type { EventEmitter as EventEmitterType } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateQuestionInput } from "@a-eye/shared";

vi.mock("server-only", () => ({}));
vi.mock("node:dns", () => ({
  promises: {
    lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
  },
}));
const { webhookPosts } = vi.hoisted(() => ({
  webhookPosts: [] as Array<{ url: string; body: Record<string, unknown> }>,
}));
vi.mock("node:https", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    request: vi.fn((options: { hostname: string; path: string }) => {
      const request = new EventEmitter() as EventEmitterType & {
        end: (body: string) => void;
        destroy: (error: Error) => void;
      };
      request.end = (body: string) => {
        webhookPosts.push({ url: `https://${options.hostname}${options.path}`, body: JSON.parse(body) as Record<string, unknown> });
        const response = new EventEmitter() as EventEmitterType & { statusCode: number; resume: () => void };
        response.statusCode = 204;
        response.resume = () => queueMicrotask(() => response.emit("end"));
        request.emit("response", response);
      };
      request.destroy = (error: Error) => request.emit("error", error);
      return request;
    }),
  };
});

vi.stubEnv("A_EYE_DB_PATH", ":memory:");
vi.stubEnv("A_EYE_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "a-eye-settlement-")));

const store = await import("./store");
const { startSettlementSweep, stopSettlementSweep } = await import("./sweep");

const question = (extra: Record<string, unknown> = {}) => ({
  lat: 37.8716,
  lng: -122.2536,
  question: "Is the Chou Hall cafe line longer than 5 people?",
  options: ["Yes", "No"],
  prize_usd: 2.5,
  min_responses: 1,
  max_responses: 2,
  closes_in_minutes: 1,
  ...extra,
});

async function createQuestion(extra: Record<string, unknown> = {}, origin = "https://origin.example") {
  return store.createQuestion(CreateQuestionInput.parse(question(extra)), undefined, undefined, origin);
}

async function addAnswer(questionId: string) {
  const observer = store.getOrCreateObserver(undefined);
  return store.addSubmission({
    question_id: questionId,
    observer_id: observer.id,
    option_index: 0,
    image: { bytes: new Uint8Array([0xff, 0xd8, Math.random() * 255]), type: "image/jpeg" },
    lat: 37.8716,
    lng: -122.2536,
    accuracy_m: 5,
    distance_m: 0,
    captured_at: new Date().toISOString(),
  });
}

beforeEach(async () => {
  webhookPosts.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  vi.stubEnv("NEXT_PHASE", "");
  await store.settleDue();
});

afterEach(() => {
  stopSettlementSweep();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("settlement sweep and webhooks", () => {
  it("settles due questions without a read and does not settle them twice", async () => {
    const id = await createQuestion();
    vi.setSystemTime(Date.now() + 60_001);

    expect(await store.settleDue()).toBe(1);
    expect(await store.settleDue()).toBe(0);
    expect((await store.getResults(id, "https://origin.example"))?.status).toBe("expired");
  });

  it("claims concurrently due questions once", async () => {
    const id = await createQuestion();
    expect((await addAnswer(id)).ok).toBe(true);
    vi.setSystemTime(Date.now() + 60_001);

    const settled = await Promise.all([store.settleDue(), store.settleDue()]);
    expect(settled.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect((await store.getResults(id, "https://origin.example"))?.raffle.seed_reveal).toBeTruthy();
  });

  it("runs a single background interval, respects disabled/build settings, and settles without requests", async () => {
    const id = await createQuestion();
    vi.setSystemTime(Date.now() + 60_001);

    expect(startSettlementSweep(1000)).toBe(true);
    expect(startSettlementSweep(1000)).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await store.getResults(id, "https://origin.example"))?.status).toBe("expired");

    stopSettlementSweep();
    expect(startSettlementSweep(0)).toBe(false);
    expect(startSettlementSweep(Number.NaN)).toBe(false);
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(startSettlementSweep(1000)).toBe(false);
  });

  it("POSTs final expired results once using the stored origin", async () => {
    const id = await createQuestion({ webhook_url: "https://hooks.example.com/x" }, "https://gallery.example");
    await store.closeNow(id);
    await store.flushWebhooks();

    expect(webhookPosts).toHaveLength(1);
    expect(webhookPosts[0]).toMatchObject({
      url: "https://hooks.example.com/x",
      body: {
        id,
        status: "expired",
        gallery_url: `https://gallery.example/q/${id}`,
      },
    });
    await store.closeNow(id);
    await store.settleDue();
    await store.flushWebhooks();
    expect(webhookPosts).toHaveLength(1);
  });

  it("POSTs settled winner results with the revealed raffle seed", async () => {
    const id = await createQuestion({
      min_responses: 1,
      max_responses: 1,
      webhook_url: "https://hooks.example.com/x",
    });
    expect(await addAnswer(id)).toMatchObject({ ok: true, closed: true });
    await store.flushWebhooks();

    expect(webhookPosts).toHaveLength(1);
    expect(webhookPosts[0]?.body).toMatchObject({ id, status: "settled", raffle: { seed_reveal: expect.any(String) } });
  });

  it("blocks loopback webhook delivery without preventing settlement", async () => {
    const id = await createQuestion({ webhook_url: "http://127.0.0.1:9/x" });
    await store.closeNow(id);
    await store.flushWebhooks();
    expect(webhookPosts).toHaveLength(0);
    expect((await store.getResults(id, "https://origin.example"))?.status).toBe("expired");
  });
});
