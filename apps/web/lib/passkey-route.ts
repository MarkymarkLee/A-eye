import { clientIp, rateLimit, tooManyRequests } from "./rate-limit";
import { isCrossSiteRequest } from "./same-origin";
import { readBodyText } from "./body";

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60_000;

export async function readPasskeyPostBody(req: Request, route: string): Promise<{ text: string } | { response: Response }> {
  if (isCrossSiteRequest(req)) return { response: Response.json({ error: "Cross-site request blocked." }, { status: 403 }) };
  const limit = rateLimit(`passkey:${route}:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) return { response: tooManyRequests(limit.retryAfterS) };
  const text = await readBodyText(req, MAX_BODY_BYTES);
  if (text === null) return { response: Response.json({ error: "Request body too large." }, { status: 413 }) };
  return { text };
}

export function parsePasskeyBody(text: string): Record<string, unknown> | null {
  try {
    const body: unknown = text ? JSON.parse(text) : {};
    return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
