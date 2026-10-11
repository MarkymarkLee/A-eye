import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimitResponse } from "./rate-limit";

afterEach(() => vi.unstubAllEnvs());

describe("MCP rate limiter", () => {
  it("returns a JSON-RPC rate-limit error and Retry-After after the fixed-window limit", async () => {
    vi.stubEnv("A_EYE_MCP_RATE_LIMIT", "1");
    const req = new Request("https://a-eye.test/mcp", { headers: { "x-real-ip": "198.51.100.44" } });
    expect(rateLimitResponse(req, 1_000)).toBeNull();
    const response = rateLimitResponse(req, 2_000)!;
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("59");
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32029, message: "Rate limit exceeded, retry in 59s" },
      id: null,
    });
  });

  it("supports disabling the limit", () => {
    vi.stubEnv("A_EYE_MCP_RATE_LIMIT", "0");
    const req = new Request("https://a-eye.test/mcp", { headers: { "x-real-ip": "198.51.100.45" } });
    expect(rateLimitResponse(req)).toBeNull();
  });
});
