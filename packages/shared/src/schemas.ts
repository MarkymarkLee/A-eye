import { z } from "zod";
import { QUESTION_STATUSES } from "./constants.js";

export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);

export const QuestionStatus = z.enum(QUESTION_STATUSES);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const askQuestionShape = {
  lat: latitude.describe("Latitude of the place to observe"),
  lng: longitude.describe("Longitude of the place to observe"),
  radius_m: z.number().int().min(10).max(5000).default(150).describe("How close an observer must be, in meters"),
  question: z.string().trim().min(3).max(280).describe("What should people nearby look at and answer?"),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(6).describe("2 to 6 answer choices"),
  allow_free_text: z.boolean().default(false).describe("Let observers add a short free-text note"),
  prize_usd: z.number().positive().max(100).default(1).describe("Raffle prize in AUSD, paid by the asking agent"),
  min_responses: z.number().int().min(1).max(100).default(3),
  max_responses: z.number().int().min(1).max(500).default(20),
  closes_in_minutes: z.number().int().min(1).max(24 * 60).default(30),
  webhook_url: z.string().url().optional().describe("Called with the results when the question closes"),
};

export const AskQuestionInput = z
  .object(askQuestionShape)
  .refine((q) => q.min_responses <= q.max_responses, {
    message: "min_responses must be <= max_responses",
    path: ["min_responses"],
  })
  .refine((q) => new Set(q.options.map((o) => o.toLowerCase())).size === q.options.length, {
    message: "options must be unique",
    path: ["options"],
  });
export type AskQuestionInput = z.infer<typeof AskQuestionInput>;

export const AskQuestionResponse = z.object({
  question_id: z.string(),
  payment_tx: z.string().nullable(),
  gallery_url: z.string().url(),
  closes_at: z.string().datetime(),
  seed_commit: z.string(),
  place_context: z.unknown().nullable(),
  web_baseline: z.unknown().nullable(),
});
export type AskQuestionResponse = z.infer<typeof AskQuestionResponse>;

export const SubmissionMeta = z.object({
  option_index: z.number().int().min(0).max(5),
  free_text: z.string().trim().max(500).optional(),
  lat: latitude,
  lng: longitude,
  accuracy_m: z.number().nonnegative(),
  captured_at: z.string().datetime(),
});
export type SubmissionMeta = z.infer<typeof SubmissionMeta>;

export const TallyEntry = z.object({
  option: z.string(),
  count: z.number().int().nonnegative(),
  pct: z.number().min(0).max(100),
});
export type TallyEntry = z.infer<typeof TallyEntry>;

export const Evidence = z.object({
  answer: z.string(),
  free_text: z.string().nullable(),
  image_url: z.string().url(),
  distance_m: z.number(),
  captured_at: z.string().datetime(),
});
export type Evidence = z.infer<typeof Evidence>;

export const RaffleInfo = z.object({
  winner: z.string().nullable(),
  payout_tx: z.string().nullable(),
  seed_commit: z.string(),
  seed_reveal: z.string().nullable(),
  entropy_block_hash: z.string().nullable(),
});
export type RaffleInfo = z.infer<typeof RaffleInfo>;

export const QuestionResults = z.object({
  question_id: z.string(),
  prompt: z.string(),
  status: QuestionStatus,
  responses: z.number().int().nonnegative(),
  tally: z.array(TallyEntry),
  gallery_url: z.string().url(),
  evidence: z.array(Evidence),
  web_baseline: z.unknown().nullable(),
  raffle: RaffleInfo,
});
export type QuestionResults = z.infer<typeof QuestionResults>;

export const Coverage = z.object({
  active_observers: z.number().int().nonnegative(),
  window_minutes: z.number().int().positive(),
  radius_m: z.number().int().positive(),
});
export type Coverage = z.infer<typeof Coverage>;

export const QuestionSummary = z.object({
  question_id: z.string(),
  prompt: z.string(),
  status: QuestionStatus,
  responses: z.number().int().nonnegative(),
  closes_at: z.string().datetime(),
  gallery_url: z.string().url(),
});
export type QuestionSummary = z.infer<typeof QuestionSummary>;
