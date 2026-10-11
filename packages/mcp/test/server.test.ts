import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { AEyeApi, type FetchLike } from "../src/api.js";
import { createServer } from "../src/server.js";

const BASE = "http://a-eye.test";
const results = (status: "open" | "closed") => ({
  question_id: "q1",
  prompt: "Is there a line?",
  status,
  responses: 2,
  tally: [
    { option: "Yes", count: 2, pct: 100 },
    { option: "No", count: 0, pct: 0 },
  ],
  gallery_url: `${BASE}/q/q1`,
  evidence: [
    {
      answer: "Yes",
      free_text: null,
      image_url: `${BASE}/img/1.jpg`,
      distance_m: 12,
      captured_at: "2026-10-11T20:00:00.000Z",
      observer_reputation: { agreement_rate: 0.8, scored_answers: 5, answer_count: 9 },
    },
  ],
  web_baseline: null,
  raffle: { winner: null, payout_tx: null, seed_commit: "ab", seed_reveal: null, entropy_block_hash: null },
});

async function connect(fetchImpl: FetchLike) {
  const server = createServer(new AEyeApi(BASE, fetchImpl), { pollIntervalMs: 1 });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("a-eye MCP server", () => {
  it("lists the five tools", async () => {
    const client = await connect(async () => new Response("{}"));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "ask_location_question",
      "check_coverage",
      "get_question_results",
      "list_my_questions",
      "wait_for_results",
    ]);
  });

  it("posts a validated question with defaults applied", async () => {
    let body: unknown;
    const client = await connect(async (url, init) => {
      expect(url).toBe(`${BASE}/api/questions`);
      body = JSON.parse(String(init?.body));
      return Response.json({
        question_id: "q1",
        payment_tx: null,
        gallery_url: `${BASE}/q/q1`,
        closes_at: "2026-10-11T20:30:00.000Z",
        seed_commit: "ab",
        place_context: null,
        web_baseline: null,
      });
    });
    const res = await client.callTool({
      name: "ask_location_question",
      arguments: { lat: 37.87, lng: -122.25, question: "Is there a line?", options: ["Yes", "No"] },
    });
    expect(res.isError).toBeFalsy();
    expect(body).toMatchObject({ radius_m: 150, prize_usd: 1, min_responses: 3 });
  });

  it("waits until the question closes and returns photos as image blocks", async () => {
    let calls = 0;
    const client = await connect(async (url) => {
      if (url.endsWith("/img/1.jpg")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
      calls += 1;
      return Response.json(results(calls < 3 ? "open" : "closed"));
    });
    const res = await client.callTool({ name: "wait_for_results", arguments: { question_id: "q1", timeout_s: 5 } });
    expect(calls).toBe(3);
    const content = res.content as Array<{ type: string; mimeType?: string; data?: string }>;
    expect(content.find((c) => c.type === "image")).toMatchObject({ mimeType: "image/jpeg", data: "AQID" });
  });

  it("annotates evidence with observer_reputation and the agreement caption", async () => {
    const client = await connect(async (url) => {
      if (url.endsWith("/img/1.jpg")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
      return Response.json(results("closed"));
    });
    const res = await client.callTool({ name: "get_question_results", arguments: { question_id: "q1" } });
    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text?: string }>;
    const parsed = JSON.parse(content[0]!.text!) as { evidence: { observer_reputation?: unknown }[] };
    expect(parsed.evidence[0]!.observer_reputation).toEqual({ agreement_rate: 0.8, scored_answers: 5, answer_count: 9 });
    expect(content.find((c) => c.text?.includes("Evidence #1"))!.text).toContain(
      "observer agreed with the crowd 80% of the time on 5 closed questions (9 answers)",
    );
  });

  it("surfaces API errors as tool errors", async () => {
    const client = await connect(async () => Response.json({ error: "Payment required" }, { status: 402 }));
    const res = await client.callTool({ name: "get_question_results", arguments: { question_id: "q1" } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("Payment required");
  });
});
