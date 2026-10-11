import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { clientIp, resolveAgent } from "./identity";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("MCP agent identity", () => {
  it("prefers a trimmed, capped explicit agent label", () => {
    const req = new Request("https://a-eye.test/mcp", {
      headers: { "x-a-eye-agent": `  ${"a".repeat(70)}  `, authorization: "Bearer secret" },
    });
    expect(resolveAgent(req)).toBe("a".repeat(64));
  });

  it("hashes bearer and query keys into stable agent identities", () => {
    const bearer = new Request("https://a-eye.test/mcp", { headers: { authorization: "Bearer api-key" } });
    const query = new Request("https://a-eye.test/mcp?key=api-key");
    expect(resolveAgent(bearer)).toBe(`key:${hash("api-key").slice(0, 24)}`);
    expect(resolveAgent(query)).toBe(resolveAgent(bearer));
  });

  it("uses the first forwarded IP for anonymous identities", () => {
    const req = new Request("https://a-eye.test/mcp", {
      headers: { "x-forwarded-for": " 203.0.113.10, 192.0.2.1", "x-real-ip": "198.51.100.1" },
    });
    expect(clientIp(req)).toBe("203.0.113.10");
    expect(resolveAgent(req)).toBe(`anon:${hash("203.0.113.10").slice(0, 16)}`);
  });

  it("falls back to x-real-ip and then local", () => {
    expect(clientIp(new Request("https://a-eye.test/mcp", { headers: { "x-real-ip": "203.0.113.20" } }))).toBe(
      "203.0.113.20",
    );
    expect(clientIp(new Request("https://a-eye.test/mcp"))).toBe("local");
  });
});
