import { handleStt } from "./stt";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit";

export async function POST(req: Request): Promise<Response> {
  const limit = rateLimit(`stt:${clientIp(req)}`, 20, 10 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterS);
  return handleStt(req);
}
