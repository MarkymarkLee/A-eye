import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockApi } from "../src/mock-api.js";
import { McpBridge } from "../src/mcp-bridge.js";
import { parseResults } from "../src/results.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const MCP_SRC = path.join(REPO, "packages", "mcp", "src", "index.ts");
const HAVE_MCP = existsSync(MCP_SRC) || existsSync(path.join(REPO, "packages", "mcp", "dist", "index.js"));

describe.skipIf(!HAVE_MCP)("integration: mock API + real MCP server", () => {
  it("ask_location_question with market_ref, then wait_for_results", async () => {
    const { server } = await startMockApi({ port: 0, responses: 4, tickMs: 50, yesRate: 1 });
    const port = (server.address() as { port: number }).port;
    const base = `http://localhost:${port}`;
    const prev = process.env.A_EYE_API_URL;
    const prevKeys = [process.env.AGENT_PRIVATE_KEY, process.env.A_EYE_AGENT_PRIVATE_KEY];
    process.env.A_EYE_API_URL = base;
    // The mock never issues a 402 challenge, but unset the wallet keys so the
    // spawned MCP can't even install a paying fetch in this test.
    delete process.env.AGENT_PRIVATE_KEY;
    delete process.env.A_EYE_AGENT_PRIVATE_KEY;
    const bridge = await McpBridge.connect();
    try {
      const ask = await bridge.callTool("ask_location_question", {
        lat: 37.8716,
        lng: -122.2536,
        question: "Is it warm outside right now?",
        options: ["Yes", "No"],
        closes_in_minutes: 1,
        market_ref: {
          provider: "gemini-predictions",
          env: "sandbox",
          contract_symbol: "GEMI-TEST-1",
          implied_yes: 0.5,
        },
      });
      expect(ask.isError).toBe(false);
      const created = JSON.parse(ask.text) as { question_id: string };
      expect(created.question_id).toBeTruthy();

      // market_ref must be stored
      const stored = (await fetch(`${base}/__mock/questions/${created.question_id}`).then((r) => r.json())) as {
        market_ref?: { contract_symbol?: string };
      };
      expect(stored.market_ref?.contract_symbol).toBe("GEMI-TEST-1");

      const waited = await bridge.callTool("wait_for_results", {
        question_id: created.question_id,
        timeout_s: 30,
        include_images: false,
      });
      expect(waited.isError).toBe(false);
      const results = parseResults(waited.text)!;
      expect(results.status).toBe("settled");
      expect(results.responses).toBe(4);
      expect(results.tally[0]!.pct).toBe(100);
    } finally {
      await bridge.close();
      if (prev === undefined) delete process.env.A_EYE_API_URL;
      else process.env.A_EYE_API_URL = prev;
      if (prevKeys[0] !== undefined) process.env.AGENT_PRIVATE_KEY = prevKeys[0];
      if (prevKeys[1] !== undefined) process.env.A_EYE_AGENT_PRIVATE_KEY = prevKeys[1];
      server.close();
    }
  }, 60_000);
});
