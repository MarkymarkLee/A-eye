import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("A_EYE_DB_PATH", ":memory:");
vi.stubEnv("A_EYE_COOKIE_SECRET", "");
afterAll(() => vi.unstubAllEnvs());

const store = await import("./store");

describe("observer store security helpers", () => {
  it("creates UUID observers and only returns existing observers by id", () => {
    const observer = store.createObserver();
    expect(observer.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(store.getObserver("seed-obs-0")).toMatchObject({ id: "seed-obs-0", display_name: "Priya Raman" });
    expect(store.getObserver("nope")).toBeUndefined();
  });

  it("keeps a generated cookie secret stable and hex encoded", () => {
    const secret = store.cookieSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(store.cookieSecret()).toBe(secret);
  });
});
