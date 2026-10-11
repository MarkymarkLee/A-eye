import { z } from "zod";

// Shared contract between the web API and the MCP server.

export const QuestionStatus = z.enum(["open", "closed", "settled", "expired"]);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const CreateQuestionInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius_m: z.number().int().min(25).max(2000).default(150),
  question: z.string().trim().min(4).max(240),
  options: z.array(z.string().trim().min(1).max(60)).min(2).max(6),
  allow_free_text: z.boolean().default(false),
  place_label: z.string().trim().max(80).optional(),
  prize_usd: z.number().positive().max(500).default(1),
  min_responses: z.number().int().min(1).max(100).default(3),
  max_responses: z.number().int().min(1).max(500).default(20),
  closes_in_minutes: z.number().int().min(1).max(24 * 60).default(30),
});
export type CreateQuestionInput = z.infer<typeof CreateQuestionInput>;

export const SubmissionFields = z.object({
  option_index: z.coerce.number().int().min(0).max(5),
  free_text: z.string().trim().max(280).optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy_m: z.coerce.number().min(0),
  captured_at: z.string().datetime(),
});
export type SubmissionFields = z.infer<typeof SubmissionFields>;

export type TallyRow = { option: string; count: number; pct: number };

export type Evidence = {
  id: string;
  answer: string;
  option_index: number;
  free_text?: string;
  image_url: string;
  distance_m: number;
  accuracy_m: number;
  captured_at: string;
  observer: string;
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
};

export type QuestionSummary = {
  id: string;
  prompt: string;
  options: string[];
  allow_free_text: boolean;
  place_label?: string;
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
};

export const GEO_RULES = {
  maxAccuracyM: 75,
  maxClockSkewMs: 2 * 60 * 1000,
} as const;

export const PLATFORM_FEE = 0.1;
