import { describe, expect, it } from "vitest";
import { CreateQuestionInput, SubmissionFields } from "../src/index";

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

describe("text and coordinate validation", () => {
  it("rejects control and bidi-override characters while allowing newlines in free text", () => {
    expect(CreateQuestionInput.safeParse({ ...input, question: "Is there a line?\u202E" }).success).toBe(false);
    expect(CreateQuestionInput.safeParse({ ...input, options: ["Yes\u0000", "No"] }).success).toBe(false);
    const fields = {
      option_index: 0,
      lat: 37.87,
      lng: -122.25,
      accuracy_m: 10,
      captured_at: "2026-01-15T12:00:00.000Z",
    };
    expect(SubmissionFields.safeParse({ ...fields, free_text: "Line one\nLine two" }).success).toBe(true);
    expect(CreateQuestionInput.safeParse({ ...input, question: "Is there a café? 👀" }).success).toBe(true);
  });

  it.each([Infinity, NaN, 91])("rejects invalid latitude %s", (lat) => {
    expect(CreateQuestionInput.safeParse({ ...input, lat }).success).toBe(false);
  });

  it.each([Infinity, NaN, 181])("rejects invalid longitude %s", (lng) => {
    expect(CreateQuestionInput.safeParse({ ...input, lng }).success).toBe(false);
  });

  it.each(["1e400", "NaN", "Infinity"])("rejects non-finite submission latitude %s", (lat) => {
    expect(
      SubmissionFields.safeParse({
        option_index: 0,
        lat,
        lng: -122.25,
        accuracy_m: 10,
        captured_at: "2026-01-15T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
