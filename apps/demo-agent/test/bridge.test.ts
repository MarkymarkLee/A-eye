import { describe, expect, it } from "vitest";
import { McpBridge } from "../src/mcp-bridge.js";

// Bridge conversion is exercised through the public surface: a fake client
// that behaves like @modelcontextprotocol/sdk's Client.

type FakeCall = { name: string; arguments: Record<string, unknown> };

function fakeBridge() {
  const calls: FakeCall[] = [];
  const fakeClient = {
    listTools: async () => ({
      tools: [
        {
          name: "check_coverage",
          description: "coverage near a point",
          inputSchema: {
            type: "object",
            properties: { lat: { type: "number" }, lng: { type: "number" } },
          },
        },
      ],
    }),
    callTool: async (req: FakeCall) => {
      calls.push(req);
      return {
        content: [
          { type: "text", text: "line one" },
          { type: "text", text: "line two" },
          { type: "image", data: "AAAA", mimeType: "image/jpeg" },
        ],
      };
    },
    close: async () => {},
  };
  const bridge = Object.create(McpBridge.prototype) as McpBridge;
  (bridge as unknown as { client: unknown }).client = fakeClient;
  (bridge as unknown as { transport: unknown }).transport = { close: async () => {} };
  return { bridge, calls };
}

describe("McpBridge conversion", () => {
  it("maps MCP tools to OpenAI function tools", async () => {
    const { bridge } = fakeBridge();
    const tools = await bridge.openAiTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      type: "function",
      function: {
        name: "check_coverage",
        description: "coverage near a point",
        parameters: { type: "object", properties: { lat: { type: "number" } } },
      },
    });
  });

  it("joins text blocks and collects images from callTool", async () => {
    const { bridge, calls } = fakeBridge();
    const res = await bridge.callTool("check_coverage", { lat: 1, lng: 2 });
    expect(calls[0]).toEqual({ name: "check_coverage", arguments: { lat: 1, lng: 2 } });
    expect(res.text).toBe("line one\nline two");
    expect(res.images).toEqual([{ data: "AAAA", mimeType: "image/jpeg" }]);
    expect(res.isError).toBe(false);
  });
});
