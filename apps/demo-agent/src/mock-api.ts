// In-memory mock of the A-eye API, for local runs and tests.
// Endpoints mirror what packages/mcp calls: POST /api/questions,
// GET /api/questions/:id, GET /api/coverage, GET /api/questions/mine,
// GET /api/photos/:id — plus GET /__mock/questions/:id for tests.

import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHOTO_FIXTURE = path.join(HERE, "..", "test", "fixtures", "photo.jpg");

export type MockOptions = {
  port?: number;
  yesRate?: number; // fraction of submissions picking option 0
  responses?: number; // total simulated observers
  tickMs?: number; // delay between simulated submissions
};

type StoredQuestion = {
  id: string;
  input: Record<string, unknown>;
  market_ref?: unknown;
  status: "open" | "closed" | "settled" | "expired";
  created_at: string;
  closes_at: string;
  seed: string;
  seed_commit: string;
  submissions: {
    id: string;
    observer: string;
    option_index: number;
    captured_at: string;
    distance_m: number;
    accuracy_m: number;
  }[];
};

// Deterministic PRNG (mulberry32) so mock answers are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

export function startMockApi(opts: MockOptions = {}): Promise<{ server: Server; port: number; url: string }> {
  const port = opts.port ?? Number(process.env.MOCK_PORT ?? 4010);
  const yesRate = opts.yesRate ?? Number(process.env.MOCK_YES_RATE ?? 0.5);
  const maxResponses = opts.responses ?? Number(process.env.MOCK_RESPONSES ?? 9);
  const tickMs = opts.tickMs ?? Number(process.env.MOCK_TICK_MS ?? 500);
  const questions = new Map<string, StoredQuestion>();
  const rng = mulberry32(0xa7e);

  const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const tallyOf = (q: StoredQuestion) => {
    const options = q.input.options as string[];
    const counts = options.map(() => 0);
    for (const s of q.submissions) counts[s.option_index] = (counts[s.option_index] ?? 0) + 1;
    const n = q.submissions.length || 1;
    return options.map((option, i) => ({
      option,
      count: counts[i] ?? 0,
      pct: Math.round(((counts[i] ?? 0) / n) * 1000) / 10,
    }));
  };

  const resultsShape = (q: StoredQuestion, origin: string) => {
    const options = q.input.options as string[];
    const winner = q.submissions[0];
    const raffle = {
      seed_commit: q.seed_commit,
      seed_reveal: q.status === "settled" ? q.seed : undefined,
      winner: q.status === "settled" ? winner?.observer ?? null : null, // old contract
      winner_observer: q.status === "settled" ? winner?.observer : undefined,
      winner_submission_id: q.status === "settled" ? winner?.id : undefined,
      prize_amount: Math.round(Number(q.input.prize_usd ?? 1) * 0.9 * 100) / 100,
      currency: "AUSD",
      payout_tx: q.status === "settled" ? "0xmockpayout" : undefined,
      mock: true,
    };
    return {
      // Superset: satisfies both Mark's QuestionResults and the old strict shape.
      id: q.id,
      question_id: q.id,
      prompt: q.input.question,
      options,
      allow_free_text: q.input.allow_free_text ?? false,
      place_label: q.input.place_label ?? null,
      lat: q.input.lat,
      lng: q.input.lng,
      radius_m: q.input.radius_m ?? 150,
      prize_amount: q.input.prize_usd ?? 1,
      currency: "AUSD",
      status: q.status,
      responses: q.submissions.length,
      min_responses: q.input.min_responses ?? 3,
      max_responses: q.input.max_responses ?? 20,
      closes_at: q.closes_at,
      created_at: q.created_at,
      tally: tallyOf(q),
      evidence: q.submissions.map((s) => ({
        id: s.id,
        answer: options[s.option_index],
        option_index: s.option_index,
        free_text: null,
        image_url: `${origin}/api/photos/${s.id}`,
        distance_m: s.distance_m,
        accuracy_m: s.accuracy_m,
        captured_at: s.captured_at,
        observer: s.observer,
        observer_reputation: { agreement_rate: 0.8, scored_answers: 5, answer_count: 9 },
      })),
      gallery_url: `${origin}/q/${q.id}`,
      market_ref: q.market_ref ?? null,
      place_context: null,
      web_baseline: null,
      raffle,
    };
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const bound = (server.address() as { port: number } | null)?.port ?? port;
    const origin = `http://localhost:${bound}`;

    if (req.method === "POST" && url.pathname === "/api/questions") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        } catch {
          return json(res, 400, { error: "Invalid JSON" });
        }
        if (typeof input.question !== "string" || input.question.length < 4) {
          return json(res, 400, { error: "question required" });
        }
        if (!Array.isArray(input.options) || input.options.length < 2) {
          return json(res, 400, { error: "options (>=2) required" });
        }
        const id = randomUUID().replace(/-/g, "").slice(0, 10);
        const seed = sha256Hex(`seed-${id}`);
        const closesIn = Number(input.closes_in_minutes ?? 5);
        const q: StoredQuestion = {
          id,
          input,
          market_ref: input.market_ref,
          status: "open",
          created_at: new Date().toISOString(),
          closes_at: new Date(Date.now() + closesIn * 60_000).toISOString(),
          seed,
          seed_commit: sha256Hex(seed),
          submissions: [],
        };
        questions.set(id, q);
        // Simulated observers, one per tick.
        for (let i = 0; i < maxResponses; i++) {
          setTimeout(() => {
            if (q.status !== "open") return;
            const option = rng() < yesRate ? 0 : Math.min(1, (input.options as string[]).length - 1);
            q.submissions.push({
              id: `s_${id}_${i}`,
              observer: `mock-observer-${i} (MOCK)`,
              option_index: option,
              captured_at: new Date().toISOString(),
              distance_m: Math.round(rng() * 120),
              accuracy_m: Math.round(5 + rng() * 30),
            });
            if (q.submissions.length >= maxResponses) {
              q.status = "settled"; // mock raffle, clearly labeled
            }
          }, tickMs * (i + 1));
        }
        json(res, 201, {
          question_id: id,
          id,
          payment_tx: null,
          gallery_url: `${origin}/q/${id}`,
          closes_at: q.closes_at,
          seed_commit: q.seed_commit,
          place_context: null,
          web_baseline: null,
        });
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/coverage") {
      return json(res, 200, { active_observers: 12, window_minutes: 15, radius_m: 500 });
    }

    if (req.method === "GET" && url.pathname === "/api/questions/mine") {
      return json(res, 200, { questions: [] });
    }

    let m = url.pathname.match(/^\/api\/questions\/([^/]+?)(\/results)?$/);
    if (req.method === "GET" && m) {
      const q = questions.get(m[1]!);
      if (!q) return json(res, 404, { error: "Not found" });
      return json(res, 200, resultsShape(q, origin));
    }

    m = url.pathname.match(/^\/api\/photos\/(.+)$/);
    if (req.method === "GET" && m) {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(readFileSync(PHOTO_FIXTURE));
      return;
    }

    m = url.pathname.match(/^\/__mock\/questions\/([^/]+)$/);
    if (req.method === "GET" && m) {
      const q = questions.get(m[1]!);
      if (!q) return json(res, 404, { error: "Not found" });
      return json(res, 200, { id: q.id, market_ref: q.market_ref ?? null, status: q.status });
    }

    json(res, 404, { error: `mock: no route ${req.method} ${url.pathname}` });
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, port, url: `http://localhost:${port}` }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.MOCK_PORT ?? 4010);
  startMockApi({ port }).then(({ url }) => {
    console.log(`mock A-eye API on ${url} (yesRate=${process.env.MOCK_YES_RATE ?? 0.5}, responses=${process.env.MOCK_RESPONSES ?? 9}, tickMs=${process.env.MOCK_TICK_MS ?? 500})`);
  });
}
