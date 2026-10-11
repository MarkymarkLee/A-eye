import { clientIp } from "./identity";

const WINDOW_MS = 60_000;
const windows = new Map<string, { count: number; resetAt: number }>();

function requestLimit() {
  const configured = Number(process.env.A_EYE_MCP_RATE_LIMIT ?? 60);
  if (configured === 0) return 0;
  if (!Number.isFinite(configured) || configured < 0) return 60;
  return Math.max(1, Math.floor(configured));
}

export function rateLimitResponse(req: Request, now = Date.now()): Response | null {
  const limit = requestLimit();
  if (limit === 0) return null;

  for (const [ip, entry] of windows) {
    if (entry.resetAt <= now) windows.delete(ip);
  }

  const ip = clientIp(req);
  let entry = windows.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    windows.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count <= limit) return null;

  const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32029, message: `Rate limit exceeded, retry in ${retryAfter}s` },
      id: null,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
