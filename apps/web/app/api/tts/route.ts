import { handleTts } from "./tts";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit";

export async function POST(req: Request): Promise<Response> {
  const limit = rateLimit(`tts:${clientIp(req)}`, 60, 10 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterS);
  return handleTts(req);
}
