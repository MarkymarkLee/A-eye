import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

const getHeader = (headers: ReturnType<typeof securityHeaders>, key: string) =>
  headers.find((header) => header.key === key)?.value;

describe("securityHeaders", () => {
  it("includes the development CSP allowances but not production HSTS", () => {
    const headers = securityHeaders({ dev: true });
    expect(getHeader(headers, "Content-Security-Policy")).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(getHeader(headers, "Content-Security-Policy")).toContain("connect-src 'self' https: wss: ws:");
    expect(getHeader(headers, "Content-Security-Policy")).not.toContain("upgrade-insecure-requests");
    expect(getHeader(headers, "Strict-Transport-Security")).toBeUndefined();
  });

  it("adds the strict production CSP and HSTS", () => {
    const headers = securityHeaders({ dev: false });
    expect(getHeader(headers, "Content-Security-Policy")).toContain("script-src 'self' 'unsafe-inline';");
    expect(getHeader(headers, "Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(getHeader(headers, "Content-Security-Policy")).not.toContain("unsafe-eval");
    expect(getHeader(headers, "Content-Security-Policy")).not.toContain("upgrade-insecure-requests");
    expect(getHeader(headers, "Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    expect(getHeader(headers, "Permissions-Policy")).toBe("camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()");
    expect(getHeader(headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(getHeader(headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(getHeader(headers, "X-Frame-Options")).toBe("DENY");
    expect(getHeader(headers, "Cross-Origin-Opener-Policy")).toBe("same-origin");
  });
});
