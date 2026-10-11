import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { encodePaymentResponseHeader } from "@x402/core/http";
import { describe, expect, it } from "vitest";
import { AEyeApi, type FetchLike } from "../src/api.js";
import { createServer } from "../src/server.js";

const BASE = "http://a-eye.test";
const PEEK_TX = `0x${"ab".repeat(32)}`;
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
  pot_usd: 1,
  ausd_flows: [],
  web_baseline: null,
  raffle: { prize_amount: 0.9, currency: "AUSD", seed_commit: "ab" },
});

async function connect(fetchImpl: FetchLike, options: { pollIntervalMs?: number; maxImages?: number } = {}) {
  const server = createServer(new AEyeApi(BASE, fetchImpl), { pollIntervalMs: 1, ...options });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("a-eye MCP server", () => {
  it("lists the six tools", async () => {
    const client = await connect(async () => new Response("{}"));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "ask_location_question",
      "check_coverage",
      "get_question_results",
      "list_my_questions",
      "peek_results",
      "wait_for_results",
    ]);
    expect(tools.find((tool) => tool.name === "ask_location_question")?.inputSchema.properties).toHaveProperty("webhook_url");
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
      arguments: {
        lat: 37.87,
        lng: -122.25,
        question: "Is there a line?",
        options: ["Yes", "No"],
        webhook_url: "https://hooks.example.com/events",
      },
    });
    expect(res.isError).toBeFalsy();
    expect(body).toMatchObject({ radius_m: 150, prize_usd: 1, min_responses: 3, webhook_url: "https://hooks.example.com/events" });
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

  it("explains sealed results and offers the paid peek", async () => {
    const sealedResponse = () =>
      Response.json({
        ...results("open"),
        sealed: true,
        peek: { price_usd: 0.02, url: `${BASE}/api/questions/q1/peek` },
        evidence: [],
      });
    const client = await connect(async () => sealedResponse());
    const res = await client.callTool({
      name: "get_question_results",
      arguments: { question_id: "q1", include_images: false },
    });
    const content = res.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toBe(
      "Results are sealed until the question closes (2 responses so far). Call peek_results to buy interim results for $0.02 AUSD, or wait_for_results.",
    );

    const waitingClient = await connect(async () => sealedResponse(), { pollIntervalMs: 1000 });
    const waiting = await waitingClient.callTool({
      name: "wait_for_results",
      arguments: { question_id: "q1", timeout_s: 1, include_images: false },
    });
    expect((waiting.content as Array<{ text?: string }>)[0]?.text).toBe(content[0]?.text);
  });

  it("fetches peek results and reports payment metadata", async () => {
    const client = await connect(async (url) => {
      expect(url).toBe(`${BASE}/api/questions/q1/peek`);
      return Response.json(
        { ...results("open"), paid: true, payment_tx: null },
        { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: PEEK_TX, network: "eip155:84532" }) } },
      );
    });
    const res = await client.callTool({
      name: "peek_results",
      arguments: { question_id: "q1", include_images: false },
    });
    const content = res.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toBe(`paid: yes; payment_tx: ${PEEK_TX}`);
    expect(JSON.parse(content[1]!.text!)).toMatchObject({ paid: true, payment_tx: PEEK_TX });
  });

  it("surfaces API errors as tool errors", async () => {
    const client = await connect(async () => Response.json({ error: "Payment required" }, { status: 402 }));
    const res = await client.callTool({ name: "get_question_results", arguments: { question_id: "q1" } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("Payment required");
  });

  it("downscales attached evidence photos to at most 512 px", async () => {
    const sharp = (await import("sharp")).default;
    const photo = await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: { r: 220, g: 30, b: 60 } },
    })
      .jpeg()
      .toBuffer();
    const client = await connect(async (url) => {
      if (url.endsWith("/img/large.jpg")) return new Response(photo, { headers: { "content-type": "image/jpeg" } });
      return Response.json({
        ...results("closed"),
        evidence: [{ ...results("closed").evidence[0], image_url: `${BASE}/img/large.jpg` }],
      });
    });
    const res = await client.callTool({ name: "get_question_results", arguments: { question_id: "q1" } });
    const image = (res.content as Array<{ type: string; mimeType?: string; data?: string }>).find((block) => block.type === "image")!;
    const metadata = await sharp(Buffer.from(image.data!, "base64")).metadata();
    expect(image.mimeType).toBe("image/jpeg");
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(512);
  });

  it("caps attached photos and reports how many were omitted", async () => {
    const tenEvidence = Array.from({ length: 10 }, (_, i) => ({
      ...results("closed").evidence[0],
      image_url: `${BASE}/img/${i}.jpg`,
    }));
    const client = await connect(
      async (url) => {
        if (url.includes("/img/")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
        return Response.json({ ...results("closed"), evidence: tenEvidence });
      },
      { maxImages: 3 },
    );
    const res = await client.callTool({ name: "get_question_results", arguments: { question_id: "q1" } });
    const content = res.content as Array<{ type: string; text?: string }>;
    expect(content.filter((block) => block.type === "image")).toHaveLength(3);
    expect(content.some((block) => block.text?.includes("+7 more photos not attached; see"))).toBe(true);
  });
});
