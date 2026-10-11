const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { ok: boolean; retryAfterS: number } {
  if (process.env.A_EYE_RATE_LIMIT === "0") return { ok: true, retryAfterS: 0 };
  if (windows.size > 10_000) {
    for (const [entryKey, entry] of windows) {
      if (entry.resetAt <= now) windows.delete(entryKey);
    }
  }

  let entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    windows.set(key, entry);
  }
  if (entry.count >= limit) {
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  entry.count += 1;
  return { ok: true, retryAfterS: 0 };
}

export function clientIp(req: Request): string {
  const cloudflare = req.headers.get("cf-connecting-ip");
  if (cloudflare !== null) return cloudflare;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded !== null) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function tooManyRequests(retryAfterS: number): Response {
  return Response.json(
    { error: `Too many requests. Try again in ${retryAfterS} s.` },
    { status: 429, headers: { "Retry-After": String(retryAfterS) } },
  );
}
