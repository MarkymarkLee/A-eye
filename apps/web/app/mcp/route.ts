import { createServer } from "@a-eye/mcp/server";
import { AEyeApi } from "@a-eye/mcp/api";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createInProcessFetch } from "@/lib/mcp/in-process-fetch";
import { resolveAgent } from "@/lib/mcp/identity";
import { rateLimitResponse } from "@/lib/mcp/rate-limit";
import { originOf } from "@/lib/origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, mcp-protocol-version, mcp-session-id, x-a-eye-agent, last-event-id",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleRequest(req: Request) {
  const limited = rateLimitResponse(req);
  if (limited) return withCors(limited);

  const origin = originOf(req);
  const api = new AEyeApi(origin, createInProcessFetch(origin, req.headers), resolveAgent(req), false);
  const server = createServer(api, { mcpPayments: true });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return withCors(await transport.handleRequest(req));
}

export const POST = handleRequest;
export const GET = handleRequest;
export const DELETE = handleRequest;
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
