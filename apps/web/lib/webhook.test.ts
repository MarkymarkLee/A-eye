import { describe, expect, it, vi } from "vitest";
import { assertPublicUrl, isPublicAddress, postWebhook } from "./webhook";

describe("webhook URL safety", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "192.0.0.1",
    "198.18.0.1",
    "198.19.255.255",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:0a00:0001",
  ])("blocks non-public address %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(["8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"])("allows public address %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it("rejects non-http, localhost, and private literal URLs", async () => {
    await expect(assertPublicUrl("ftp://example.com")).rejects.toThrow("http(s)");
    await expect(assertPublicUrl("https://localHost")).rejects.toThrow("localhost");
    await expect(assertPublicUrl("https://api.localhost/hook")).rejects.toThrow("localhost");
    await expect(assertPublicUrl("http://127.0.0.1")).rejects.toThrow("not public");
    await expect(assertPublicUrl("http://[::1]")).rejects.toThrow("not public");
  });

  it("rejects a hostname resolving to any private address and accepts public results", async () => {
    const privateLookup = vi.fn(async () => [{ address: "10.0.0.5", family: 4 }]);
    const publicLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    await expect(assertPublicUrl("https://hooks.example.com", privateLookup)).rejects.toThrow("public addresses");
    await expect(assertPublicUrl("https://hooks.example.com", publicLookup)).resolves.toBeUndefined();
  });
});

describe("postWebhook", () => {
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const payload = { id: "question-1", status: "settled" };

  it("posts JSON over POST with redirects disabled and returns on first success", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => new Response(null, { status: 204 }));
    const result = await postWebhook("https://hooks.example.com/x", payload, { fetchImpl, lookup });
    expect(result).toMatchObject({ ok: true, status: 204, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "user-agent": "A-eye-webhook/1",
        "x-a-eye-event": "question.closed",
      },
      body: JSON.stringify(payload),
    });
  });

  it("retries a non-2xx response and succeeds on the next attempt", async () => {
    const fetchImpl = vi
      .fn<(_: string | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(postWebhook("https://hooks.example.com/x", payload, { fetchImpl, lookup, retryDelayMs: 0 })).resolves.toMatchObject({
      ok: true,
      status: 200,
      attempts: 2,
    });
  });

  it("returns failures without throwing and retries network errors", async () => {
    const failures = vi.fn(async () => new Response(null, { status: 500 }));
    await expect(
      postWebhook("https://hooks.example.com/x", payload, { fetchImpl: failures, lookup, retryDelayMs: 0 }),
    ).resolves.toMatchObject({ ok: false, status: 500, attempts: 2 });

    const networkFailure = vi
      .fn<(_: string | URL, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(
      postWebhook("https://hooks.example.com/x", payload, { fetchImpl: networkFailure, lookup, retryDelayMs: 0 }),
    ).resolves.toMatchObject({ ok: true, attempts: 2 });
  });

  it("does not fetch a blocked URL", async () => {
    const fetchImpl = vi.fn();
    await expect(postWebhook("http://127.0.0.1:9/x", payload, { fetchImpl })).resolves.toMatchObject({
      ok: false,
      attempts: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
