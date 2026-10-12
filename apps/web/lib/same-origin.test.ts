import { describe, expect, it } from "vitest";
import { isCrossSiteRequest } from "./same-origin";

const request = (headers: Record<string, string>) => new Request("https://app.example/path", { headers });

describe("isCrossSiteRequest", () => {
  it("trusts same-origin and none fetch metadata, blocks other fetch sites", () => {
    expect(isCrossSiteRequest(request({ "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteRequest(request({ "sec-fetch-site": "none" }))).toBe(false);
    expect(isCrossSiteRequest(request({ "sec-fetch-site": "same-site" }))).toBe(true);
    expect(isCrossSiteRequest(request({ "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  it("compares Origin against the forwarded or host header", () => {
    expect(isCrossSiteRequest(request({ origin: "https://app.example", host: "app.example" }))).toBe(false);
    expect(isCrossSiteRequest(request({ origin: "https://evil.example", host: "app.example" }))).toBe(true);
    expect(isCrossSiteRequest(request({ origin: "null", host: "app.example" }))).toBe(true);
    expect(isCrossSiteRequest(request({ origin: "invalid url", host: "app.example" }))).toBe(true);
  });

  it("allows requests without browser origin metadata", () => {
    expect(isCrossSiteRequest(request({}))).toBe(false);
  });
});
