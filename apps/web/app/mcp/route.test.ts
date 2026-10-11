import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapMCPClientWithPayment } from "@x402/mcp";
import { x402Client } from "@x402/fetch";
import { AUSD, X402_NETWORK } from "@a-eye/shared";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AEyeApi } from "@a-eye/mcp/api";
import { createServer } from "@a-eye/mcp/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/enrich", () => ({ startEnrichment: vi.fn() }));
vi.mock("@/lib/push", () => ({ startNearbyPush: vi.fn() }));

const PUBLIC_ORIGIN = "http://a-eye.test";
const FACILITATOR = "http://facilitator.test";
const TREASURY = "0x293214291186180810902D97994c2C72fE88255A";
const PAYMENT_TX = `0x${"ab".repeat(32)}`;
const generatedPayer = privateKeyToAccount(generatePrivateKey());
const realFetch = globalThis.fetch;
const facilitatorCalls: string[] = [];

vi.stubEnv("A_EYE_DB_PATH", ":memory:");
vi.stubEnv("A_EYE_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "a-eye-mcp-uploads-")));
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("ALLOW_UNPAID_QUESTIONS", "1");
vi.stubEnv("A_EYE_TREASURY_ADDRESS", TREASURY);
vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", generatePrivateKey());
vi.stubEnv("X402_FACILITATOR_URL", FACILITATOR);
vi.stubEnv("A_EYE_MCP_RATE_LIMIT", "100");

const { POST, GET, DELETE, OPTIONS } = await import("./route");
const store = await import("@/lib/store");
const { resolveAgent } = await import("@/lib/mcp/identity");

afterAll(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

const routes: Record<string, (req: Request) => Promise<Response>> = { POST, GET, DELETE };

function createHttpClient(headers: HeadersInit = {}) {
  const client = new Client({ name: "web-route-test", version: "0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${PUBLIC_ORIGIN}/mcp`), {
    requestInit: { headers },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      return routes[request.method]!(request);
    },
  });
  return { client, transport };
}

async function connectHttp(headers: HeadersInit = {}) {
  const client = createHttpClient(headers);
  await client.client.connect(client.transport);
  return client;
}

const questionArgs = {
  lat: 37.8716,
  lng: -122.2536,
  question: "Is the Chou Hall cafe line longer than 5 people?",
  options: ["Yes", "No"],
  min_responses: 1,
  max_responses: 1,
};

function firstText(result: unknown) {
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) return "";
  const block = result.content.find(
    (item): item is { type: "text"; text: string } =>
      Boolean(item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item && typeof item.text === "string"),
  );
  return block?.text ?? "";
}

describe("hosted /mcp endpoint", () => {
  it("exposes the same tools as the stdio server", async () => {
    const web = await connectHttp();
    const webTools = (await web.client.listTools()).tools.map((tool) => tool.name).sort();
    const server = createServer(new AEyeApi(PUBLIC_ORIGIN, async () => Response.json({})));
    const client = new Client({ name: "stdio-tools-test", version: "0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const stdioTools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(webTools).toEqual(stdioTools);
    await web.client.close();
    await client.close();
  });

  it("creates questions, returns results, and isolates list_my_questions by bearer identity", async () => {
    vi.stubEnv("ALLOW_UNPAID_QUESTIONS", "1");
    const agentA = await connectHttp({ authorization: "Bearer remote-agent-a" });
    const asked = await agentA.client.callTool({ name: "ask_location_question", arguments: questionArgs });
    expect(asked.isError).toBeFalsy();
    const question = JSON.parse(firstText(asked)) as { question_id: string };
    const results = await agentA.client.callTool({
      name: "get_question_results",
      arguments: { question_id: question.question_id },
    });
    expect(JSON.parse(firstText(results))).toMatchObject({ id: question.question_id });
    const mineA = await agentA.client.callTool({ name: "list_my_questions" });
    expect(JSON.parse(firstText(mineA)).map((item: { id: string }) => item.id)).toContain(question.question_id);

    const agentB = await connectHttp({ authorization: "Bearer remote-agent-b" });
    const mineB = await agentB.client.callTool({ name: "list_my_questions" });
    expect(JSON.parse(firstText(mineB))).toEqual([]);
    await agentA.client.close();
    await agentB.client.close();
  });

  it("rate-limits by client IP and adds browser CORS headers", async () => {
    vi.stubEnv("A_EYE_MCP_RATE_LIMIT", "1");
    const request = () =>
      new Request(`${PUBLIC_ORIGIN}/mcp`, {
        method: "GET",
        headers: { "x-forwarded-for": "203.0.113.151" },
      });
    const first = await GET(request());
    expect(first.headers.get("access-control-allow-origin")).toBe("*");
    const limited = await GET(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(await limited.json()).toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32029, message: expect.stringMatching(/^Rate limit exceeded, retry in \d+s$/) },
      id: null,
    });
    const options = OPTIONS();
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("returns a payment challenge and creates a paid question once through the x402 MCP client", async () => {
    vi.stubEnv("A_EYE_MCP_RATE_LIMIT", "100");
    vi.stubEnv("ALLOW_UNPAID_QUESTIONS", "");
    facilitatorCalls.length = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith(FACILITATOR)) throw new Error(`Unexpected network request: ${url}`);
      const op = url.slice(FACILITATOR.length);
      facilitatorCalls.push(op);
      if (op === "/supported") {
        return Response.json({
          kinds: [{ x402Version: 2, scheme: "exact", network: X402_NETWORK }],
          extensions: [],
          signers: {},
        });
      }
      const { paymentPayload } = JSON.parse(String(init?.body));
      const payer = paymentPayload.payload.authorization.from;
      if (op === "/verify") return Response.json({ isValid: true, payer });
      return Response.json({ success: true, transaction: PAYMENT_TX, network: X402_NETWORK, payer });
    }) as typeof fetch;

    const identityRequest = new Request(`${PUBLIC_ORIGIN}/mcp`, {
      headers: { authorization: "Bearer paid-remote-agent" },
    });
    const agentIdentity = resolveAgent(identityRequest);
    const remote = await connectHttp({ authorization: "Bearer paid-remote-agent" });
    const paymentClient = new x402Client()
      .register(X402_NETWORK, new ExactEvmScheme(generatedPayer))
      .setSpendControls({
        allowedAssets: [{ network: X402_NETWORK, asset: AUSD.address, maxAmountPerPayment: "25000000" }],
      });
    const payingClient = wrapMCPClientWithPayment(remote.client, paymentClient);

    const result = await payingClient.callTool("ask_location_question", questionArgs);
    expect(result.paymentMade).toBe(true);
    expect(result.paymentResponse).toMatchObject({ success: true, transaction: PAYMENT_TX });
    expect(facilitatorCalls.filter((call) => call === "/settle")).toHaveLength(1);
    const stored = await store.questionsByAgent(agentIdentity, PUBLIC_ORIGIN);
    const questionId = JSON.parse(firstText(result)) as { question_id: string };
    expect(stored.map((question) => question.id)).toContain(questionId.question_id);
    const peek = await payingClient.callTool("peek_results", {
      question_id: questionId.question_id,
      include_images: false,
    });
    expect(peek.paymentMade).toBe(true);
    expect(peek.paymentResponse).toMatchObject({ success: true, transaction: PAYMENT_TX });
    expect(facilitatorCalls.filter((call) => call === "/settle")).toHaveLength(2);
    const mine = await remote.client.callTool({ name: "list_my_questions" });
    expect(JSON.parse(firstText(mine)).map((item: { id: string }) => item.id)).toContain(questionId.question_id);
    await remote.client.close();
  });
});
