import "server-only";
import type { MarketRef } from "@a-eye/shared";
import type { ActivityCounters, ActivityEvent, ActivityResponse, OpenQuestion } from "./activity-types";
import { imageUrl } from "./storage";
import { db, payoutAmount, potAmount, settleDue } from "./store";
import { peekPaywallActive } from "./payments";
import { tally } from "./tally";
import { roundAmount } from "./money";

type Row = Record<string, unknown>;

const priority: Record<ActivityEvent["type"], number> = {
  question_asked: 1,
  photo: 2,
  peek: 2.5,
  question_closed: 3,
  raffle_reveal: 4,
  payout: 5,
};

function asMarketRef(value: unknown): MarketRef | undefined {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return typeof value === "object" && value !== null ? (value as MarketRef) : undefined;
}

function whereAfter(column: string, since?: string) {
  return since ? ` where ${column} > ?` : "";
}

function argsFor(since: string | undefined, limit: number): (string | number)[] {
  return since ? [since, limit] : [limit];
}

function leaderOf(rows: ReturnType<typeof tally>) {
  const leader = rows.reduce<(typeof rows)[number] | undefined>(
    (best, row) => (best === undefined || row.count > best.count ? row : best),
    undefined,
  );
  return leader?.count ? leader : undefined;
}

export async function activity(opts: { origin: string; since?: string; limit?: number }): Promise<ActivityResponse> {
  await settleDue();
  const conn = db();
  const since = opts.since;
  const limit = Math.min(200, Math.max(1, Math.trunc(Number.isFinite(opts.limit) ? opts.limit! : 60)));
  const events: ActivityEvent[] = [];
  const sealOpenPhotos = peekPaywallActive();

  const asked = conn
    .prepare(
      `select * from questions${whereAfter("created_at", since)} order by created_at desc limit ?`,
    )
    .all(...argsFor(since, limit)) as Row[];
  for (const row of asked) {
    const market = asMarketRef(row.market_ref);
    events.push({
      id: `question_asked:${row.id as string}`,
      type: "question_asked",
      at: row.created_at as string,
      question_id: row.id as string,
      prompt: row.prompt as string,
      place_label: (row.place_label as string | null) ?? undefined,
      agent_label: row.agent_label as string,
      prize_amount: row.prize_amount as number,
      currency: row.currency as string,
      payment_tx: (row.payment_tx as string | null) ?? undefined,
      payer_address: (row.payer_address as string | null) ?? undefined,
      market_label: typeof market?.label === "string" ? market.label : undefined,
    });
  }

  const photos = conn
    .prepare(
      `select s.*, q.prompt, q.place_label, q.options, q.status as qstatus, o.display_name
         from submissions s
         join questions q on q.id = s.question_id
         join observers o on o.id = s.observer_id${whereAfter("s.captured_at", since)}
        order by s.captured_at desc limit ?`,
    )
    .all(...argsFor(since, limit)) as Row[];
  for (const row of photos) {
    const options = JSON.parse(row.options as string) as string[];
    const key = row.image_key as string | null;
    const sealed = sealOpenPhotos && row.qstatus === "open";
    events.push({
      id: `photo:${row.id as string}`,
      type: "photo",
      at: row.captured_at as string,
      question_id: row.question_id as string,
      prompt: row.prompt as string,
      place_label: (row.place_label as string | null) ?? undefined,
      submission_id: row.id as string,
      answer: sealed ? "" : options[row.option_index as number]!,
      ...(sealed ? { sealed: true as const } : {}),
      free_text: sealed ? undefined : (row.free_text as string | null) ?? undefined,
      distance_m: row.distance_m as number,
      accuracy_m: row.accuracy_m as number,
      observer: row.display_name as string,
      thumb_url: key ? await imageUrl(key, opts.origin) : (row.image_external_url as string),
    });
  }

  const peeks = conn
    .prepare(
      `select p.*, q.prompt, q.place_label, q.currency
         from peeks p join questions q on q.id = p.question_id
        where p.payment_tx is not null${since ? " and p.created_at > ?" : ""}
        order by p.created_at desc limit ?`,
    )
    .all(...argsFor(since, limit)) as Row[];
  for (const row of peeks) {
    events.push({
      id: `peek:${row.id as string}`,
      type: "peek",
      at: row.created_at as string,
      question_id: row.question_id as string,
      prompt: row.prompt as string,
      place_label: (row.place_label as string | null) ?? undefined,
      tx: row.payment_tx as string,
      amount: roundAmount(row.amount as number),
      currency: row.currency as string,
      payer_address: (row.payer_address as string | null) ?? undefined,
      responses_at_peek: row.responses_at_peek as number,
    });
  }

  const closed = conn
    .prepare(
      `select * from questions
        where status in ('settled', 'expired')${since ? " and coalesce(closed_at, closes_at) > ?" : ""}
        order by coalesce(closed_at, closes_at) desc limit ?`,
    )
    .all(...argsFor(since, limit)) as Row[];
  for (const row of closed) {
    const options = JSON.parse(row.options as string) as string[];
    const submissions = conn
      .prepare("select option_index from submissions where question_id = ?")
      .all(row.id as string) as { option_index: number }[];
    const counts = tally(options, submissions.map((submission) => submission.option_index));
    const top = leaderOf(counts);
    events.push({
      id: `question_closed:${row.id as string}`,
      type: "question_closed",
      at: (row.closed_at as string | null) ?? (row.closes_at as string),
      question_id: row.id as string,
      prompt: row.prompt as string,
      place_label: (row.place_label as string | null) ?? undefined,
      status: row.status as "settled" | "expired",
      responses: submissions.length,
      min_responses: row.min_responses as number,
      leader: top,
      tally: counts,
    });
  }

  const reveals = conn
    .prepare(
      `select r.*, q.prompt, q.place_label, q.seed_commit, q.closed_at, q.closes_at,
              (select count(*) from submissions s where s.question_id = q.id) as entrants,
              (select o.display_name from submissions s join observers o on o.id = s.observer_id
                where s.id = r.winner_submission_id) as winner_observer
         from raffles r join questions q on q.id = r.question_id
        where 1 = 1${since ? " and coalesce(q.closed_at, q.closes_at) > ?" : ""}
        order by coalesce(q.closed_at, q.closes_at) desc limit ?`,
    )
    .all(...argsFor(since, limit)) as Row[];
  for (const row of reveals) {
    events.push({
      id: `raffle_reveal:${row.question_id as string}`,
      type: "raffle_reveal",
      at: (row.closed_at as string | null) ?? (row.closes_at as string),
      question_id: row.question_id as string,
      prompt: row.prompt as string,
      place_label: (row.place_label as string | null) ?? undefined,
      seed_commit: row.seed_commit as string,
      seed_reveal: row.seed_reveal as string,
      entropy_block_hash: row.entropy_block_hash as string,
      entropy_block_number: (row.entropy_block_number as number | null) ?? undefined,
      winner_submission_id: (row.winner_submission_id as string | null) ?? undefined,
      winner_observer: (row.winner_observer as string | null) ?? undefined,
      entrants: row.entrants as number,
    });
  }

  const payouts = conn
    .prepare(
      `select r.question_id, r.payout_tx, q.prompt, q.place_label, q.prize_amount, q.currency,
              q.closed_at, q.closes_at,
              (select o.display_name from submissions s join observers o on o.id = s.observer_id
                where s.id = r.winner_submission_id) as winner_observer
         from raffles r join questions q on q.id = r.question_id
        where r.payout_tx is not null${since ? " and coalesce(q.closed_at, q.closes_at) > ?" : ""}
        order by coalesce(q.closed_at, q.closes_at) desc limit ?`,
    )
    .all(...argsFor(since, limit)) as Row[];
  for (const row of payouts) {
    events.push({
      id: `payout:${row.question_id as string}`,
      type: "payout",
      kind: "payout",
      at: (row.closed_at as string | null) ?? (row.closes_at as string),
      question_id: row.question_id as string,
      prompt: row.prompt as string,
      place_label: (row.place_label as string | null) ?? undefined,
      tx: row.payout_tx as string,
      amount: payoutAmount(potAmount({ id: row.question_id as string, prize_amount: row.prize_amount as number })),
      currency: row.currency as string,
      to_label: (row.winner_observer as string | null) ?? "observer",
    });
  }

  const refunds = conn
    .prepare(
      `select id, prompt, place_label, prize_amount, currency, refund_tx, closed_at, closes_at
         from questions
        where refund_tx is not null${since ? " and coalesce(closed_at, closes_at) > ?" : ""}
        order by coalesce(closed_at, closes_at) desc limit ?`,
    )
    .all(...argsFor(since, limit)) as Row[];
  for (const row of refunds) {
    events.push({
      id: `refund:${row.id as string}`,
      type: "payout",
      kind: "refund",
      at: (row.closed_at as string | null) ?? (row.closes_at as string),
      question_id: row.id as string,
      prompt: row.prompt as string,
      place_label: (row.place_label as string | null) ?? undefined,
      tx: row.refund_tx as string,
      amount: row.prize_amount as number,
      currency: row.currency as string,
      to_label: "agent",
    });
  }

  const counterRow = conn
    .prepare(
      `select (select count(*) from questions) as questions,
              (select count(*) from questions where status = 'open') as open_questions,
              (select count(*) from submissions) as verified_photos,
              (select count(distinct observer_id) from submissions) as unique_observers,
              (select coalesce(sum(prize_amount), 0) from questions where payment_tx is not null) as ausd_bounties,
              (select coalesce(sum(amount), 0) from peeks where payment_tx is not null) as ausd_peeks,
              (select count(*) from questions where payment_tx is not null) +
                (select count(*) from raffles where payout_tx is not null) +
                (select count(*) from questions where refund_tx is not null) +
                (select count(*) from peeks where payment_tx is not null) as onchain_txs`,
    )
    .get() as ActivityCounters;
  const payoutPrizes = conn
    .prepare(
      "select q.id, q.prize_amount from raffles r join questions q on q.id = r.question_id where r.payout_tx is not null",
    )
    .all() as { id: string; prize_amount: number }[];
  const paid = payoutPrizes.reduce((sum, row) => sum + payoutAmount(potAmount(row)), 0);
  const counters: ActivityCounters = {
    ...counterRow,
    ausd_paid: roundAmount(paid),
    ausd_bounties: roundAmount(counterRow.ausd_bounties),
    ausd_peeks: roundAmount(counterRow.ausd_peeks),
  };

  const openRows = conn
    .prepare(
      `select q.id, q.prompt, q.place_label, q.max_responses, q.closes_at, q.prize_amount, q.currency,
              (select count(*) from submissions s where s.question_id = q.id) as responses
         from questions q where q.status = 'open'
        order by q.created_at desc limit 6`,
    )
    .all() as Row[];
  const open: OpenQuestion[] = openRows.map((row) => ({
    id: row.id as string,
    prompt: row.prompt as string,
    place_label: (row.place_label as string | null) ?? undefined,
    responses: row.responses as number,
    max_responses: row.max_responses as number,
    closes_at: row.closes_at as string,
    prize_amount: row.prize_amount as number,
    currency: row.currency as string,
  }));

  events.sort((a, b) => b.at.localeCompare(a.at) || priority[b.type] - priority[a.type]);
  const filtered = since ? events.filter((event) => event.at > since) : events;
  return {
    now: new Date().toISOString(),
    counters,
    open,
    events: filtered.slice(0, limit),
  };
}
