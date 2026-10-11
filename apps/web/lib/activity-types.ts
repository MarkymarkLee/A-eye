import type { TallyRow } from "@a-eye/shared";

type Base = { id: string; at: string; question_id: string; prompt: string; place_label?: string };

export type ActivityEvent =
  | (Base & {
      type: "question_asked";
      agent_label: string;
      prize_amount: number;
      currency: string;
      payment_tx?: string;
      payer_address?: string;
      market_label?: string;
    })
  | (Base & {
      type: "photo";
      submission_id: string;
      answer: string;
      sealed?: true;
      free_text?: string;
      distance_m: number;
      accuracy_m: number;
      observer: string;
      thumb_url: string;
    })
  | (Base & {
      type: "peek";
      tx: string;
      amount: number;
      currency: string;
      payer_address?: string;
      responses_at_peek: number;
    })
  | (Base & {
      type: "question_closed";
      status: "settled" | "expired";
      responses: number;
      min_responses: number;
      leader?: TallyRow;
      tally: TallyRow[];
    })
  | (Base & {
      type: "raffle_reveal";
      seed_commit: string;
      seed_reveal: string;
      entropy_block_hash: string;
      entropy_block_number?: number;
      winner_submission_id?: string;
      winner_observer?: string;
      entrants: number;
    })
  | (Base & {
      type: "payout";
      kind: "payout" | "refund";
      tx: string;
      amount: number;
      currency: string;
      to_label: string;
    });

export type ActivityCounters = {
  questions: number;
  open_questions: number;
  verified_photos: number;
  unique_observers: number;
  ausd_paid: number;
  ausd_bounties: number;
  ausd_peeks: number;
  onchain_txs: number;
};

export type OpenQuestion = {
  id: string;
  prompt: string;
  place_label?: string;
  responses: number;
  max_responses: number;
  closes_at: string;
  prize_amount: number;
  currency: string;
};

export type ActivityResponse = {
  now: string;
  counters: ActivityCounters;
  open: OpenQuestion[];
  events: ActivityEvent[];
};
