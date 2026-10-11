import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader, decodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { AUSD, X402_NETWORK } from "@a-eye/shared";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapMCPClientWithPayment } from "@x402/mcp";
import { x402Client } from "@x402/fetch";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
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

async function connect(
  fetchImpl: FetchLike,
  options: { pollIntervalMs?: number; maxImages?: number; mcpPayments?: boolean } = {},
) {
  const server = createServer(new AEyeApi(BASE, fetchImpl), { pollIntervalMs: 1, ...options });
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

  it("surfaces API errors as tool errors", async () => {
    const client = await connect(async () => Response.json({ error: "Payment required" }, { status: 402 }));
    const res = await client.callTool({ name: "get_question_results", arguments: { question_id: "q1" } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("Payment required");
  });

  it("keeps the stdio payment error text when MCP payments are disabled", async () => {
    const client = await connect(async () => Response.json({ error: "Payment required" }, { status: 402 }));
    const result = await client.callTool({
      name: "ask_location_question",
      arguments: { lat: 37.87, lng: -122.25, question: "Is there a line?", options: ["Yes", "No"] },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Payment required. Set AGENT_PRIVATE_KEY (a Base Sepolia wallet holding AUSD) so the MCP server can pay via x402.",
      },
    ]);
    expect(result.structuredContent).toBeUndefined();
  });

  it("returns the x402 MCP payment-required result when MCP payments are enabled", async () => {
    const required: PaymentRequired = {
      x402Version: 2,
      resource: { url: `${BASE}/api/questions` },
      accepts: [
        {
          scheme: "exact",
          network: X402_NETWORK,
          asset: AUSD.address,
          amount: "2500000",
          payTo: "0x293214291186180810902D97994c2C72fE88255A",
          maxTimeoutSeconds: 300,
          extra: { ...AUSD.eip712 },
        },
      ],
    };
    const client = await connect(
      async () => Response.json(
        { error: "Payment required" },
        { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required) } },
      ),
      { mcpPayments: true },
    );
    const result = await client.callTool({
      name: "ask_location_question",
      arguments: { lat: 37.87, lng: -122.25, question: "Is there a line?", options: ["Yes", "No"] },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(required);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(required) },
      {
        type: "text",
        text: 'Needs an x402 payment of 2.5 AUSD on Base Sepolia (eip155:84532). Use an x402-aware MCP client (@x402/mcp) that retries with _meta["x402/payment"], or run the a-eye-mcp stdio server with AGENT_PRIVATE_KEY.',
      },
    ]);
  });

  it("sends MCP payment metadata as PAYMENT-SIGNATURE and returns the settle receipt in metadata", async () => {
    const payload = {
      x402Version: 2,
      accepted: { scheme: "exact", network: X402_NETWORK, asset: AUSD.address, amount: "2500000", payTo: "0x1234" },
      payload: { authorization: { from: "0x1234" }, signature: "test" },
    } as PaymentPayload;
    const receipt = { success: true, transaction: `0x${"ab".repeat(32)}`, network: X402_NETWORK, payer: "0x1234" };
    let signature: string | null = null;
    const client = await connect(async (_url, init) => {
      signature = new Headers(init?.headers).get("PAYMENT-SIGNATURE");
      return Response.json(
        { question_id: "q1", payment_tx: null, gallery_url: `${BASE}/q/q1`, seed_commit: "ab" },
        { status: 201, headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(receipt) } },
      );
    }, { mcpPayments: true });
    const result = await client.callTool({
      name: "ask_location_question",
      arguments: { lat: 37.87, lng: -122.25, question: "Is there a line?", options: ["Yes", "No"] },
      _meta: { "x402/payment": payload },
    });
    expect(decodePaymentSignatureHeader(signature!)).toEqual(payload);
    expect(result._meta?.["x402/payment-response"]).toEqual(receipt);
  });

  it("works with the official x402 MCP payment client", async () => {
    const required: PaymentRequired = {
      x402Version: 2,
      resource: { url: `${BASE}/api/questions` },
      accepts: [
        {
          scheme: "exact",
          network: X402_NETWORK,
          asset: AUSD.address,
          amount: "1000000",
          payTo: "0x293214291186180810902D97994c2C72fE88255A",
          maxTimeoutSeconds: 300,
          extra: { ...AUSD.eip712 },
        },
      ],
    };
    const receipt = { success: true, transaction: `0x${"cd".repeat(32)}`, network: X402_NETWORK };
    let paidRequest: PaymentPayload | undefined;
    const server = createServer(
      new AEyeApi(BASE, async (_url, init) => {
        const signature = new Headers(init?.headers).get("PAYMENT-SIGNATURE");
        if (!signature) {
          return Response.json(
            { error: "Payment required" },
            { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required) } },
          );
        }
        paidRequest = decodePaymentSignatureHeader(signature);
        return Response.json(
          { question_id: "q1", payment_tx: null, gallery_url: `${BASE}/q/q1`, seed_commit: "ab" },
          { status: 201, headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(receipt) } },
        );
      }),
      { mcpPayments: true },
    );
    const client = new Client({ name: "x402-test", version: "0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const payer = privateKeyToAccount(generatePrivateKey());
    const paymentClient = new x402Client().register(X402_NETWORK, new ExactEvmScheme(payer)).setSpendControls({
      allowedAssets: [{ network: X402_NETWORK, asset: AUSD.address, maxAmountPerPayment: "25000000" }],
    });
    const paidClient = wrapMCPClientWithPayment(client, paymentClient);
    const result = await paidClient.callTool("ask_location_question", {
      lat: 37.87,
      lng: -122.25,
      question: "Is there a line?",
      options: ["Yes", "No"],
    });
    expect(result.paymentMade).toBe(true);
    expect(result.paymentResponse).toEqual(receipt);
    expect(paidRequest?.accepted).toMatchObject({ asset: AUSD.address, amount: "1000000" });
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
