import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("A_EYE_DB_PATH", ":memory:");
vi.stubEnv("A_EYE_UPLOAD_DIR", "/tmp/a-eye-in-process-fetch-test");
vi.mock("@/app/api/images/[...key]/route", () => ({
  GET: async (req: Request, { params }: { params: Promise<{ key: string[] }> }) =>
    Response.json({
      key: (await params).key,
      host: req.headers.get("host"),
      forwardedHost: req.headers.get("x-forwarded-host"),
      proto: req.headers.get("x-forwarded-proto"),
      ip: req.headers.get("x-forwarded-for"),
      realIp: req.headers.get("x-real-ip"),
      authorization: req.headers.get("authorization"),
      paymentSignature: req.headers.get("payment-signature"),
      contentType: req.headers.get("content-type"),
      agent: req.headers.get("x-a-eye-agent"),
    }),
}));
vi.mock("@/app/api/questions/[id]/peek/route", () => ({
  GET: async (_req: Request, { params }: { params: Promise<{ id: string }> }) =>
    Response.json({ peeked: (await params).id }),
}));
vi.mock("@/app/api/questions/[id]/market/route", () => ({
  GET: async (_req: Request, { params }: { params: Promise<{ id: string }> }) =>
    Response.json({ market: (await params).id }),
}));

const { createInProcessFetch } = await import("./in-process-fetch");
const fetchImpl = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetchImpl;
  vi.restoreAllMocks();
});

describe("createInProcessFetch", () => {
  it("routes image paths in process with only trusted incoming headers and API headers", async () => {
    const fetch = createInProcessFetch(
      "https://public.example",
      new Headers({
        host: "internal.local",
        "x-forwarded-host": "public.example",
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.1",
        "x-real-ip": "198.51.100.9",
        authorization: "Bearer transport-key",
        "payment-signature": "transport-payment",
      }),
    );
    const response = await fetch("https://public.example/api/images/a/b/photo.jpg", {
      headers: {
        "content-type": "application/json",
        "x-a-eye-agent": "remote-agent",
      },
    });
    expect(await response.json()).toEqual({
      key: ["a", "b", "photo.jpg"],
      host: "internal.local",
      forwardedHost: "public.example",
      proto: "https",
      ip: "203.0.113.1",
      realIp: "198.51.100.9",
      authorization: null,
      paymentSignature: null,
      contentType: "application/json",
      agent: "remote-agent",
    });

    const paidResponse = await fetch("https://public.example/api/images/a/b/photo.jpg", {
      headers: { "payment-signature": "api-payment" },
    });
    expect((await paidResponse.json()).paymentSignature).toBe("api-payment");
  });

  it("returns 404 for unknown same-origin paths without making a network request", async () => {
    const network = vi.fn();
    globalThis.fetch = network;
    const fetch = createInProcessFetch("https://public.example", new Headers());
    const response = await fetch("https://public.example/unknown");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(network).not.toHaveBeenCalled();
  });

  it("dispatches interim-results routes in process before the dynamic question route", async () => {
    const fetch = createInProcessFetch("https://public.example", new Headers());
    const response = await fetch("https://public.example/api/questions/q1/peek");
    expect(await response.json()).toEqual({ peeked: "q1" });
  });

  it("dispatches market-comparison routes in process", async () => {
    const fetch = createInProcessFetch("https://public.example", new Headers());
    const response = await fetch("https://public.example/api/questions/q1/market");
    expect(await response.json()).toEqual({ market: "q1" });
  });

  it("uses global fetch for external presigned image URLs", async () => {
    const response = Response.json({ ok: true });
    const network = vi.fn().mockResolvedValue(response);
    globalThis.fetch = network;
    const fetch = createInProcessFetch("https://public.example", new Headers({ authorization: "Bearer secret" }));
    expect(await fetch("https://images.example/photo.jpg")).toBe(response);
    expect(network).toHaveBeenCalledExactlyOnceWith("https://images.example/photo.jpg", undefined);
  });
});
