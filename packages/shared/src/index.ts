import { z } from "zod";

// Shared contract between the web API and the MCP server.

export const QuestionStatus = z.enum(["open", "closed", "settled", "expired"]);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const UNSAFE_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;
export const isSafeText = (value: string) => !UNSAFE_TEXT.test(value);
const SAFE_TEXT_ERROR = "Must not contain control or bidi-override characters.";

/**
 * Optional provenance for a question that is tied to a prediction-market
 * contract (e.g. Gemini Predictions). Loose record so extra keys survive.
 */
export const MarketRef = z
  .object({
    provider: z.string(),
    env: z.enum(["sandbox", "production"]).optional(),
    event_ticker: z.string().optional(),
    contract_symbol: z.string().optional(),
    label: z.string().optional(),
    implied_yes: z.number().min(0).max(1).nullable().optional(),
  })
  .loose();
export type MarketRef = z.infer<typeof MarketRef>;

export const CreateQuestionInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius_m: z.number().int().min(25).max(2000).default(150),
  question: z.string().trim().min(4).max(240).refine(isSafeText, SAFE_TEXT_ERROR),
  options: z
    .array(z.string().trim().min(1).max(60).refine(isSafeText, SAFE_TEXT_ERROR))
    .min(2)
    .max(6)
    .refine((opts) => new Set(opts.map((o) => o.trim().toLowerCase())).size === opts.length, "options must be distinct"),
  allow_free_text: z.boolean().default(false),
  place_label: z.string().trim().max(80).refine(isSafeText, SAFE_TEXT_ERROR).optional(),
  prize_usd: z
    .number()
    .min(0.01)
    .max(500)
    .refine((v) => Math.abs(v * 1e6 - Math.round(v * 1e6)) < 1e-6, { message: "at most 6 decimal places" })
    .default(1),
  min_responses: z.number().int().min(1).max(100).default(3),
  max_responses: z.number().int().min(1).max(500).default(20),
  closes_in_minutes: z.number().int().min(1).max(24 * 60).default(30),
  webhook_url: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine((url) => /^https?:\/\//i.test(url), "webhook_url must be http(s)")
    .optional()
    .describe("POSTed the final results JSON once when the question settles or expires."),
  market_ref: MarketRef.optional(),
  /** Lock the pot in an XRPL testnet escrow (no-op when the server has no XRPL wallets configured). */
  xrpl_escrow: z.boolean().optional(),
});
export type CreateQuestionInput = z.infer<typeof CreateQuestionInput>;

export const SubmissionFields = z.object({
  option_index: z.coerce.number().int().min(0).max(5),
  free_text: z.string().trim().max(280).refine(isSafeText, SAFE_TEXT_ERROR).optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy_m: z.coerce.number().min(0),
  captured_at: z.string().datetime(),
});
export type SubmissionFields = z.infer<typeof SubmissionFields>;

export type TallyRow = { option: string; count: number; pct: number };

export type AusdFlow = {
  kind: "bounty" | "peek" | "payout" | "refund";
  amount: number;
  currency: string;
  tx: string;
  url: string;
  from_label: "agent" | `agent ${string}` | "treasury";
  to_label: "treasury" | "agent" | string;
  at?: string;
};

/** How often an observer's answers matched the majority of the other answers on closed questions; weight evidence by it. */
export type ObserverReputation = { agreement_rate: number | null; scored_answers: number; answer_count: number };

export type Evidence = {
  id: string;
  observer_reputation: ObserverReputation;
  answer: string;
  option_index: number;
  free_text?: string;
  image_url: string;
  distance_m: number;
  accuracy_m: number;
  captured_at: string;
  observer: string;
};

export const PayoutRail = z.enum(["evm", "xrpl"]);
export type PayoutRail = z.infer<typeof PayoutRail>;

/** XRPL testnet pot escrow for a question; tx fields are hashes, *_url are explorer links. */
export type XrplPotInfo = {
  state: "escrowed" | "settling" | "finished" | "canceled";
  amount_xrp: string;
  owner: string;
  offer_sequence: number;
  escrow_tx: string;
  escrow_url: string;
  finish_tx?: string;
  finish_url?: string;
  payout_tx?: string;
  payout_url?: string;
  cancel_tx?: string;
  cancel_url?: string;
};

export type RaffleInfo = {
  seed_commit: string;
  seed_reveal?: string;
  entropy_block_hash?: string;
  entropy_block_number?: number;
  winner_submission_id?: string;
  winner_observer?: string;
  prize_amount: number;
  currency: string;
  payout_tx?: string;
  payout_url?: string;
  payout_status?: "awaiting_address" | "pending" | "failed" | "paid";
  xrpl?: XrplPotInfo;
};

export type QuestionSummary = {
  id: string;
  prompt: string;
  options: string[];
  allow_free_text: boolean;
  place_label?: string;
  market_ref?: MarketRef;
  lat: number;
  lng: number;
  radius_m: number;
  prize_amount: number;
  currency: string;
  status: QuestionStatus;
  responses: number;
  min_responses: number;
  max_responses: number;
  closes_at: string;
  created_at: string;
  distance_m?: number;
};

export type QuestionResults = QuestionSummary & {
  tally: TallyRow[];
  evidence: Evidence[];
  web_baseline?: { answer: string; source: string };
  raffle: RaffleInfo;
  gallery_url: string;
  sealed?: boolean;
  peek?: { price_usd: number; url: string };
  pot_usd: number;
  ausd_flows: AusdFlow[];
};

export const GEO_RULES = {
  maxAccuracyM: 75,
  maxClockSkewMs: 2 * 60 * 1000,
} as const;

export const PLATFORM_FEE = 0.1;

export * from "./constants";
export * from "./money";
export * from "./context";

/** Raw zod shape of CreateQuestionInput, for MCP tool input schemas. */
export const askQuestionShape = CreateQuestionInput.shape;

export type CreateQuestionResponse = {
  question_id: string;
  gallery_url: string;
  seed_commit: string;
  payment_tx: string | null;
  xrpl_escrow_tx?: string | null;
  place_context?: unknown;
  web_baseline?: unknown;
};

export type Coverage = {
  active_observers: number;
  window_minutes: number;
  radius_m: number;
};
