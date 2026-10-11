import type { CreateQuestionInput, WebBaseline } from "@a-eye/shared";
import { placeContext, webBaseline } from "./context";
import { setQuestionEnrichment } from "./store";

type EnrichmentDependencies = {
  placeContext: typeof placeContext;
  webBaseline: typeof webBaseline;
  save: typeof setQuestionEnrichment;
};

export async function enrichQuestion(
  id: string,
  input: CreateQuestionInput,
  deps: EnrichmentDependencies = { placeContext, webBaseline, save: setQuestionEnrichment },
): Promise<void> {
  try {
    const place = await deps.placeContext(input.lat, input.lng);
    const baseline = await deps.webBaseline(input.question, input.options, input.lat, input.lng, {
      placeName: input.place_label ?? place?.name ?? undefined,
      timeoutMs: 25_000,
    });
    const patch: { web_baseline?: WebBaseline | null; place_label?: string | null } = {};
    if (!input.place_label && place?.name) patch.place_label = place.name;
    if (baseline !== null) patch.web_baseline = baseline;
    if (patch.place_label !== undefined || patch.web_baseline !== undefined) deps.save(id, patch);
  } catch {
    console.warn("enrich failed", id);
  }
}

export function startEnrichment(id: string, input: CreateQuestionInput): void {
  void enrichQuestion(id, input);
}
