// Lenient parsing of A-eye question results. The shape differs between
// versions (Mark's QuestionResults vs the older strict contract), so accept
// both everywhere.

export type TallyRow = { option: string; count: number; pct: number };

export type ParsedResults = {
  id: string;
  prompt?: string;
  status?: string;
  responses: number;
  tally: TallyRow[];
  evidence: Record<string, unknown>[];
  gallery_url?: string;
  raffle?: {
    seed_commit?: string;
    seed_reveal?: string;
    winner?: string | null;
    winner_observer?: string | null;
    winner_submission_id?: string;
    prize_amount?: number;
    currency?: string;
    payout_tx?: string;
  };
  raw: Record<string, unknown>;
};

export function parseResults(text: string): ParsedResults | undefined {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    // MCP results tools may append per-evidence text after the JSON block —
    // extract the first balanced {...} object and parse that.
    obj = extractFirstJsonObject(text);
    if (obj === undefined) return undefined;
  }

function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

  const r = obj as Record<string, unknown>;
  const id = (r.id ?? r.question_id) as string | undefined;
  if (!id) return undefined;
  const tally = Array.isArray(r.tally)
    ? (r.tally as Record<string, unknown>[]).map((t) => ({
        option: String(t.option ?? ""),
        count: Number(t.count ?? 0),
        pct: Number(t.pct ?? 0),
      }))
    : [];
  return {
    id,
    prompt: r.prompt as string | undefined,
    status: r.status as string | undefined,
    responses: Number(r.responses ?? 0),
    tally,
    evidence: Array.isArray(r.evidence) ? (r.evidence as Record<string, unknown>[]) : [],
    gallery_url: r.gallery_url as string | undefined,
    raffle: r.raffle as ParsedResults["raffle"],
    raw: r,
  };
}

export function formatSummary(r: ParsedResults): string {
  const gallery = r.gallery_url ? `, gallery: ${r.gallery_url}` : "";
  if (r.responses === 0 || r.tally.length === 0) {
    return `No answers yet (${r.responses} humans)${gallery}`;
  }
  const top = [...r.tally].sort((a, b) => b.count - a.count)[0]!;
  return `${Math.round(top.pct)}% ${top.option.toLowerCase()} (${r.responses} humans)${gallery}`;
}

export function formatRaffle(r: ParsedResults): string {
  const raffle = r.raffle;
  if (!raffle) return "Raffle: not drawn yet";
  const winner = raffle.winner ?? raffle.winner_observer ?? raffle.winner_submission_id;
  if (!winner) return `Raffle: not drawn yet (status ${r.status ?? "unknown"})`;
  const bits = [`Raffle winner: ${winner}`];
  if (raffle.prize_amount != null) bits.push(`prize ${raffle.prize_amount} ${raffle.currency ?? "AUSD"}`);
  if (raffle.payout_tx) bits.push(`payout tx ${raffle.payout_tx}`);
  if (raffle.seed_reveal) bits.push(`seed reveal ${raffle.seed_reveal}`);
  return bits.join(" · ");
}
