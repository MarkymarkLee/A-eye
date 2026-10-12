import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import { aEyeApiUrl } from "./config.js";

export type ToolImage = { data: string; mimeType: string };

export type ToolCallResult = {
  text: string;
  images: ToolImage[];
  isError: boolean;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
// apps/demo-agent/src -> repo root
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

function tsxBin(): string {
  return path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
}

/**
 * How to spawn the A-eye MCP server:
 *  - A_EYE_MCP_COMMAND (whitespace-split) if set
 *  - node packages/mcp/dist/index.js if a build exists
 *  - tsx packages/mcp/src/index.ts otherwise
 */
export function mcpSpawnSpec(): { command: string; args: string[] } {
  const custom = process.env.A_EYE_MCP_COMMAND?.trim();
  if (custom) {
    const [command, ...args] = custom.split(/\s+/);
    return { command: command!, args };
  }
  const dist = path.join(REPO_ROOT, "packages", "mcp", "dist", "index.js");
  if (existsSync(dist)) return { command: process.execPath, args: [dist] };
  const src = path.join(REPO_ROOT, "packages", "mcp", "src", "index.ts");
  return { command: process.execPath, args: [tsxBin(), src] };
}

export class McpBridge {
  private client: Client;
  private transport: StdioClientTransport;

  private constructor(client: Client, transport: StdioClientTransport) {
    this.client = client;
    this.transport = transport;
  }

  static async connect(): Promise<McpBridge> {
    const spec = mcpSpawnSpec();
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      // The SDK filters env by default; the payments lane needs the agent key.
      env: { ...process.env, A_EYE_API_URL: aEyeApiUrl() } as Record<string, string>,
      stderr: "inherit",
    });
    const client = new Client({ name: "a-eye-demo-agent", version: "0.0.0" });
    await client.connect(transport);
    return new McpBridge(client, transport);
  }

  async close() {
    await this.client.close().catch(() => {});
    await this.transport.close().catch(() => {});
  }

  /** MCP tools converted to OpenAI function tools. */
  async openAiTools(): Promise<ChatCompletionFunctionTool[]> {
    const { tools } = await this.client.listTools();
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
      },
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    try {
      const result = (await this.client.callTool({ name, arguments: args })) as CallToolResult;
      const texts: string[] = [];
      const images: ToolImage[] = [];
      for (const block of result.content ?? []) {
        if (block.type === "text") texts.push(block.text);
        else if (block.type === "image") images.push({ data: block.data, mimeType: block.mimeType });
      }
      return { text: texts.join("\n"), images, isError: Boolean(result.isError) };
    } catch (err) {
      return { text: `Tool error: ${err instanceof Error ? err.message : String(err)}`, images: [], isError: true };
    }
  }
}
