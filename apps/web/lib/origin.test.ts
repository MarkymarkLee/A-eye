import { afterEach, describe, expect, it, vi } from "vitest";

const { getHeaders } = vi.hoisted(() => ({ getHeaders: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: getHeaders }));

import { originOf } from "./origin";
import { requestOrigin } from "./request-origin";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("trusted origin selection", () => {
  it("prefers A_EYE_PUBLIC_URL and strips trailing slashes", async () => {
    vi.stubEnv("A_EYE_PUBLIC_URL", "https://trusted.example///");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://render.example");
    getHeaders.mockResolvedValue(new Headers({ "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" }));
    const req = new Request("http://internal.example/path", { headers: { "x-forwarded-host": "evil.example" } });
    expect(originOf(req)).toBe("https://trusted.example");
    expect(await requestOrigin()).toBe("https://trusted.example");
    expect(getHeaders).not.toHaveBeenCalled();
  });

  it("uses RENDER_EXTERNAL_URL when the public URL is unset", async () => {
    vi.stubEnv("A_EYE_PUBLIC_URL", "");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://render.example/");
    getHeaders.mockResolvedValue(new Headers({ host: "internal.example" }));
    expect(originOf(new Request("http://internal.example"))).toBe("https://render.example");
    expect(await requestOrigin()).toBe("https://render.example");
  });

  it("retains header-derived origins when no trusted URL is configured", async () => {
    vi.stubEnv("A_EYE_PUBLIC_URL", "");
    vi.stubEnv("RENDER_EXTERNAL_URL", "");
    getHeaders.mockResolvedValue(new Headers({ "x-forwarded-host": "public.example", "x-forwarded-proto": "https" }));
    expect(originOf(new Request("http://internal.example", { headers: { "x-forwarded-host": "public.example" } }))).toBe(
      "http://public.example",
    );
    expect(await requestOrigin()).toBe("https://public.example");
  });
});
