import { describe, expect, it } from "vitest";
import { CreateQuestionInput } from "../src/index";

const input = {
  lat: 37.87,
  lng: -122.25,
  question: "Is there a line?",
  options: ["Yes", "No"],
};

describe("CreateQuestionInput.webhook_url", () => {
  it("accepts HTTP(S) URLs and rejects other or malformed URLs", () => {
    expect(CreateQuestionInput.safeParse({ ...input, webhook_url: "https://hooks.example.com/events" }).success).toBe(true);
    expect(CreateQuestionInput.safeParse({ ...input, webhook_url: "ftp://x" }).success).toBe(false);
    expect(CreateQuestionInput.safeParse({ ...input, webhook_url: "not a url" }).success).toBe(false);
  });
});
