import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateQuestionInput, type PlaceContext, type WebBaseline } from "@a-eye/shared";
import { enrichQuestion } from "./enrich";

vi.mock("server-only", () => ({}));

const questionInput = (overrides: Partial<CreateQuestionInput> = {}) =>
  CreateQuestionInput.parse({
    lat: 37.87235,
    lng: -122.25432,
    question: "Is there a line at Ladle and Leaf?",
    options: ["No line", "Short line", "Long line"],
    ...overrides,
  });

const place: PlaceContext = {
  name: "Ladle and Leaf",
  category: "cafe",
  address: "Berkeley, California",
  hours: null,
  website: null,
  phone: null,
  summary: null,
  distance_m: 16,
  provider: "osm",
  sources: ["https://www.openstreetmap.org/node/5443857083"],
};

const baseline: WebBaseline = {
  answer: "There is a short line.",
  source: "example.com",
  option_index: 1,
  option: "Short line",
  confidence: "medium",
  sources: ["https://example.com"],
  partial: false,
  fetched_at: "2026-10-11T20:00:00.000Z",
};

function makeDeps(placeResult: PlaceContext | null = place, baselineResult: WebBaseline | null = baseline) {
  return {
    placeContext: vi.fn().mockResolvedValue(placeResult),
    webBaseline: vi.fn().mockResolvedValue(baselineResult),
    save: vi.fn(),
  };
}

describe("enrichQuestion", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uses the discovered place name and saves place and baseline", async () => {
    const deps = makeDeps();
    await enrichQuestion("question-1", questionInput(), deps);

    expect(deps.webBaseline).toHaveBeenCalledWith(
      "Is there a line at Ladle and Leaf?",
      ["No line", "Short line", "Long line"],
      37.87235,
      -122.25432,
      { placeName: "Ladle and Leaf", timeoutMs: 25_000 },
    );
    expect(deps.save).toHaveBeenCalledWith("question-1", {
      place_label: "Ladle and Leaf",
      web_baseline: baseline,
    });
  });

  it("prefers a supplied place label and does not overwrite it", async () => {
    const deps = makeDeps();
    await enrichQuestion("question-2", questionInput({ place_label: "Custom name" }), deps);

    expect(deps.webBaseline).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.any(Number),
      expect.any(Number),
      { placeName: "Custom name", timeoutMs: 25_000 },
    );
    expect(deps.save).toHaveBeenCalledWith("question-2", { web_baseline: baseline });
  });

  it("omits web_baseline when no baseline is available", async () => {
    const deps = makeDeps(place, null);
    await enrichQuestion("question-3", questionInput(), deps);

    expect(deps.save).toHaveBeenCalledWith("question-3", { place_label: "Ladle and Leaf" });
  });

  it("warns without rejecting when a dependency throws", async () => {
    const deps = makeDeps();
    deps.placeContext.mockRejectedValue(new Error("offline"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(enrichQuestion("question-4", questionInput(), deps)).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith("enrich failed", "question-4");
    expect(deps.save).not.toHaveBeenCalled();
  });
});
