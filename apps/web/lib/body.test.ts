import { describe, expect, it } from "vitest";
import { readBodyText } from "./body";

const request = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://app.example", { method: "POST", headers, body });

describe("readBodyText", () => {
  it("reads a body under the limit", async () => {
    expect(await readBodyText(request("hello"), 8)).toBe("hello");
  });

  it("rejects a body using content-length before reading it", async () => {
    expect(await readBodyText(request("hello", { "content-length": "99" }), 8)).toBeNull();
  });

  it("rejects an oversized streamed body without content-length", async () => {
    expect(await readBodyText(request("too many bytes"), 4)).toBeNull();
  });

  it("returns an empty string for an empty body", async () => {
    expect(await readBodyText(new Request("https://app.example", { method: "POST" }), 8)).toBe("");
  });
});
