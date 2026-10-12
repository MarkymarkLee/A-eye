import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, rateLimit, tooManyRequests } from "./rate-limit";

afterEach(() => vi.unstubAllEnvs());

describe("rateLimit", () => {
  it("allows the limit and blocks the next request with a retry interval", () => {
    expect(rateLimit("allow-limit", 2, 10_000, 100)).toMatchObject({ ok: true });
    expect(rateLimit("allow-limit", 2, 10_000, 200)).toMatchObject({ ok: true });
    expect(rateLimit("allow-limit", 2, 10_000, 500)).toMatchObject({ ok: false, retryAfterS: 10 });
  });

  it("resets after the fixed window and separates keys", () => {
    expect(rateLimit("reset-window", 1, 1_000, 100)).toMatchObject({ ok: true });
    expect(rateLimit("reset-window", 1, 1_000, 200)).toMatchObject({ ok: false });
    expect(rateLimit("reset-window", 1, 1_000, 1_100)).toMatchObject({ ok: true });
    expect(rateLimit("independent-window", 1, 1_000, 200)).toMatchObject({ ok: true });
  });

  it("honors the global kill switch", () => {
    vi.stubEnv("A_EYE_RATE_LIMIT", "0");
    expect(rateLimit("disabled", 0, 1, 100)).toEqual({ ok: true, retryAfterS: 0 });
  });

  it("extracts the client IP by precedence and builds 429 responses", async () => {
    const req = (headers: Record<string, string>) => new Request("https://example.test", { headers });
    expect(clientIp(req({ "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "198.51.100.1" }))).toBe("192.0.2.1");
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.1, 198.51.100.2", "x-real-ip": "203.0.113.1" }))).toBe("198.51.100.1");
    expect(clientIp(req({ "x-forwarded-for": " 198.51.100.1 , 198.51.100.2" }))).toBe("198.51.100.1");
    expect(clientIp(req({ "x-real-ip": "203.0.113.1" }))).toBe("203.0.113.1");
    expect(clientIp(req({}))).toBe("unknown");
    const response = tooManyRequests(12);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(await response.json()).toEqual({ error: "Too many requests. Try again in 12 s." });
  });
});
