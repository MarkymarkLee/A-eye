import { describe, expect, it } from "vitest";
import { matchSpokenOption, spokenQuestion } from "./voice-match";

const options = ["No line", "Short line", "Long line"];

describe("matchSpokenOption", () => {
  it("matches an option said on its own, ignoring case and punctuation", () => {
    expect(matchSpokenOption("Short line.", options)).toBe(1);
  });

  it("matches an option phrase inside a sentence on word boundaries", () => {
    expect(matchSpokenOption("There's a long line right now", options)).toBe(2);
    expect(matchSpokenOption("nothing here", ["No", "Yes"])).toBeNull();
  });

  it("ignores an option that is only part of a longer matched option", () => {
    expect(matchSpokenOption("it is very busy", ["Busy", "Very busy"])).toBe(1);
  });

  it("returns null when two different options are both said", () => {
    expect(matchSpokenOption("short line or long line", options)).toBeNull();
  });

  it("matches spoken option numbers and ordinals", () => {
    expect(matchSpokenOption("option two", options)).toBe(1);
    expect(matchSpokenOption("the first one", options)).toBe(0);
    expect(matchSpokenOption("number 3", options)).toBe(2);
  });

  it("rejects out-of-range or ambiguous numbers and empty transcripts", () => {
    expect(matchSpokenOption("option five", options)).toBeNull();
    expect(matchSpokenOption("one or two", options)).toBeNull();
    expect(matchSpokenOption("  ", options)).toBeNull();
  });
});

describe("spokenQuestion", () => {
  it("reads the prompt followed by numbered options", () => {
    expect(spokenQuestion("Is there a line?", ["No", "Yes"])).toBe("Is there a line? Options: 1, No. 2, Yes.");
  });
});
