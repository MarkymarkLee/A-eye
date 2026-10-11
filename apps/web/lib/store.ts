import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  PLATFORM_FEE,
  type CreateQuestionInput,
  type Evidence,
  type MarketRef,
  type QuestionResults,
  type QuestionStatus,
  type QuestionSummary,
  type WebBaseline,
} from "@a-eye/shared";
import { distanceM } from "./geo";
import { drawWinner, latestBlock, newSeed, sha256Hex } from "./raffle";
import { prizeUnits, sendFromTreasury, winnerPayoutUnits } from "./payments";
import { imageUrl, putImage } from "./storage";
import { tally } from "./tally";
import {
  computeStats,
  reputationOf,
  type AnswerRow,
  type LeaderboardEntry,
  type LeaderboardRange,
  type ObserverStats,
  type WinRow,
} from "./reputation";
import { postWebhook } from "./webhook";

/*
 * Local SQLite database (node:sqlite, no native build). Tables follow
 * PLAN.md: questions, submissions, raffles, observers. Photos live in S3
 * (see storage.ts); rows keep only the object key and its SHA-256.
 */

type QuestionRow = {
  id: string;
  agent_label: string;
  payer_address: string | null;
  payment_tx: string | null;
  refund_tx: string | null;
  prompt: string;
  options: string;
  allow_free_text: number;
  place_label: string | null;
  lat: number;
  lng: number;
  radius_m: number;
  prize_amount: number;
  currency: string;
  min_responses: number;
  max_responses: number;
  closes_at: string;
  created_at: string;
  status: QuestionStatus;
  seed: string;
  seed_commit: string;
  web_baseline: string | null;
  market_ref: string | null;
  webhook_url: string | null;
  webhook_origin: string | null;
  webhook_state: string | null;
};

type SubmissionRow = {
  id: string;
  question_id: string;
  observer_id: string;
  option_index: number;
  free_text: string | null;
  image_key: string | null;
  image_external_url: string | null;
  image_sha256: string;
  lat: number;
  lng: number;
  accuracy_m: number;
  distance_m: number;
  captured_at: string;
};

type RaffleRow = {
  question_id: string;
  seed_reveal: string;
  entropy_block_hash: string;
  entropy_block_number: number | null;
  winner_submission_id: string | null;
  payout_tx: string | null;
};

export type Observer = {
  id: string;
  display_name: string;
  evm_address?: string;
  created_at: string;
};

const SCHEMA = `
create table if not exists observers (
  id text primary key,
  display_name text not null,
  evm_address text,
  created_at text not null
);
create table if not exists questions (
  id text primary key,
  agent_label text not null,
  prompt text not null,
  options text not null,
  allow_free_text integer not null default 0,
  place_label text,
  lat real not null,
  lng real not null,
  radius_m integer not null,
  prize_amount real not null,
  currency text not null,
  min_responses integer not null,
  max_responses integer not null,
  closes_at text not null,
  created_at text not null,
  status text not null default 'open',
  seed text not null,
  seed_commit text not null,
  web_baseline text,
  payer_address text,
  payment_tx text,
  refund_tx text,
  market_ref text,
  webhook_url text,
  webhook_origin text,
  webhook_state text
);
create index if not exists questions_status_idx on questions(status, closes_at);
create index if not exists questions_geo_idx on questions(lat, lng);
create table if not exists submissions (
  id text primary key,
  question_id text not null references questions(id),
  observer_id text not null references observers(id),
  option_index integer not null,
  free_text text,
  image_key text,
  image_external_url text,
  image_sha256 text not null unique,
  lat real not null,
  lng real not null,
  accuracy_m real not null,
  distance_m integer not null,
  captured_at text not null,
  unique (question_id, observer_id)
);
create table if not exists raffles (
  question_id text primary key references questions(id),
  seed_reveal text not null,
  entropy_block_hash text not null,
  entropy_block_number integer,
  winner_submission_id text,
  payout_tx text
);
create table if not exists push_subscriptions (
  endpoint text primary key,
  observer_id text not null references observers(id),
  p256dh text not null,
  auth text not null,
  lat real,
  lng real,
  location_at text,
  last_push_at text,
  created_at text not null
);
create index if not exists push_subscriptions_geo_idx on push_subscriptions(lat, lng);
`;

const g = globalThis as unknown as { __aeyeDb?: DatabaseSync };

/** Columns added after the first deploy; `create table if not exists` won't add them to an existing file. */
function migrate(conn: DatabaseSync) {
  const cols = new Set((conn.prepare("pragma table_info(questions)").all() as { name: string }[]).map((c) => c.name));
  for (const col of ["payer_address", "payment_tx", "refund_tx", "market_ref", "webhook_url", "webhook_origin", "webhook_state"]) {
    if (!cols.has(col)) conn.exec(`alter table questions add column ${col} text`);
  }
}

function db(): DatabaseSync {
  if (!g.__aeyeDb) {
    const file = process.env.A_EYE_DB_PATH ?? path.join(process.cwd(), ".data", "a-eye.db");
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    const conn = new DatabaseSync(file);
    conn.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    conn.exec(SCHEMA);
    migrate(conn);
    const { n } = conn.prepare("select count(*) as n from questions").get() as { n: number };
    if (n === 0) seed(conn);
    g.__aeyeDb = conn;
  }
  return g.__aeyeDb;
}

const shortId = () => randomUUID().replace(/-/g, "").slice(0, 10);

// ---------- observers ----------

function toObserver(row: Record<string, unknown>): Observer {
  return {
    id: row.id as string,
    display_name: row.display_name as string,
    evm_address: (row.evm_address as string | null) ?? undefined,
    created_at: row.created_at as string,
  };
}

export function getOrCreateObserver(id: string | undefined): Observer {
  if (id) {
    const row = db().prepare("select * from observers where id = ?").get(id);
    if (row) return toObserver(row);
  }
  const obs: Observer = {
    id: id ?? randomUUID(),
    display_name: `observer-${shortId().slice(0, 4)}`,
    created_at: new Date().toISOString(),
  };
  db()
    .prepare("insert into observers (id, display_name, created_at) values (?, ?, ?)")
    .run(obs.id, obs.display_name, obs.created_at);
  return obs;
}

export function updateObserver(id: string, patch: { display_name?: string; evm_address?: string | null }) {
  const obs = getOrCreateObserver(id);
  const next = {
    display_name: patch.display_name ?? obs.display_name,
    evm_address: patch.evm_address === undefined ? obs.evm_address ?? null : patch.evm_address,
  };
  db()
    .prepare("update observers set display_name = ?, evm_address = ? where id = ?")
    .run(next.display_name, next.evm_address, id);
  return getOrCreateObserver(id);
}

export function observerEntries(observerId: string) {
  const rows = db()
    .prepare(
      `select s.id as submission_id, s.option_index, s.captured_at, q.id as question_id, q.prompt, q.options,
              q.status, q.prize_amount, q.currency, r.winner_submission_id
         from submissions s
         join questions q on q.id = s.question_id
    left join raffles r on r.question_id = q.id
        where s.observer_id = ?
     order by s.captured_at desc`,
    )
    .all(observerId) as Record<string, unknown>[];
  return rows.map((r) => ({
    submission_id: r.submission_id as string,
    question_id: r.question_id as string,
    prompt: r.prompt as string,
    answer: (JSON.parse(r.options as string) as string[])[r.option_index as number]!,
    captured_at: r.captured_at as string,
    status: r.status as QuestionStatus,
    won: r.winner_submission_id === r.submission_id,
    prize: payoutAmount(r.prize_amount as number),
    currency: r.currency as string,
  }));
}

// ---------- questions ----------

export function createQuestion(
  input: CreateQuestionInput,
  agentLabel = "unpaid-dev-agent",
  payment?: { payer: string; tx: string | null },
  origin?: string,
) {
  const { seed: s, commit } = newSeed();
  const now = Date.now();
  const id = shortId();
  db()
    .prepare(
      `insert into questions (id, agent_label, prompt, options, allow_free_text, place_label, lat, lng, radius_m,
         prize_amount, currency, min_responses, max_responses, closes_at, created_at, status, seed, seed_commit,
         payer_address, payment_tx, market_ref, webhook_url, webhook_origin)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUSD', ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      agentLabel,
      input.question,
      JSON.stringify(input.options),
      input.allow_free_text ? 1 : 0,
      input.place_label ?? null,
      input.lat,
      input.lng,
      input.radius_m,
      input.prize_usd,
      input.min_responses,
      Math.max(input.max_responses, input.min_responses),
      new Date(now + input.closes_in_minutes * 60_000).toISOString(),
      new Date(now).toISOString(),
      s,
      commit,
      payment?.payer ?? null,
      payment?.tx ?? null,
      input.market_ref ? JSON.stringify(input.market_ref) : null,
      input.webhook_url ?? null,
      origin ?? null,
    );
  return id;
}

export function setQuestionEnrichment(
  id: string,
  patch: { web_baseline?: WebBaseline | null; place_label?: string | null },
) {
  if (patch.web_baseline !== undefined) {
    db().prepare("update questions set web_baseline = ? where id = ?").run(JSON.stringify(patch.web_baseline), id);
  }
  if (patch.place_label !== undefined) {
    db()
      .prepare("update questions set place_label = ? where id = ? and place_label is null")
      .run(patch.place_label?.slice(0, 80) ?? null, id);
  }
}

const questionById = (id: string) =>
  db().prepare("select * from questions where id = ?").get(id) as QuestionRow | undefined;

const submissionsFor = (questionId: string) =>
  db()
    .prepare("select * from submissions where question_id = ? order by captured_at asc")
    .all(questionId) as SubmissionRow[];

const responseCount = (questionId: string) =>
  (db().prepare("select count(*) as n from submissions where question_id = ?").get(questionId) as { n: number }).n;

function summarize(q: QuestionRow, from?: { lat: number; lng: number }): QuestionSummary {
  return {
    id: q.id,
    prompt: q.prompt,
    options: JSON.parse(q.options) as string[],
    allow_free_text: q.allow_free_text === 1,
    place_label: q.place_label ?? undefined,
    market_ref: q.market_ref ? (JSON.parse(q.market_ref) as MarketRef) : undefined,
    lat: q.lat,
    lng: q.lng,
    radius_m: q.radius_m,
    prize_amount: q.prize_amount,
    currency: q.currency,
    status: q.status,
    responses: responseCount(q.id),
    min_responses: q.min_responses,
    max_responses: q.max_responses,
    closes_at: q.closes_at,
    created_at: q.created_at,
    distance_m: from ? Math.round(distanceM(from.lat, from.lng, q.lat, q.lng)) : undefined,
  };
}

export async function nearbyQuestions(lat: number, lng: number, maxKm: number) {
  await settleDue();
  // Bounding box in SQL, exact great-circle distance in JS.
  const dLat = maxKm / 111.32;
  const dLng = maxKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const rows = db()
    .prepare("select * from questions where lat between ? and ? and lng between ? and ?")
    .all(lat - dLat, lat + dLat, lng - dLng, lng + dLng) as QuestionRow[];
  return rows
    .map((q) => summarize(q, { lat, lng }))
    .filter((q) => q.distance_m! <= maxKm * 1000)
    .sort((a, b) => {
      if ((a.status === "open") !== (b.status === "open")) return a.status === "open" ? -1 : 1;
      return a.distance_m! - b.distance_m!;
    });
}

export async function allOpenQuestions() {
  await settleDue();
  const rows = db()
    .prepare("select * from questions where status = 'open' order by created_at desc")
    .all() as QuestionRow[];
  return rows.map((q) => summarize(q));
}

export async function getResults(id: string, origin: string): Promise<QuestionResults | undefined> {
  await settleDue();
  return buildResults(id, origin);
}

async function buildResults(id: string, origin: string): Promise<QuestionResults | undefined> {
  const q = questionById(id);
  if (!q) return undefined;
  const options = JSON.parse(q.options) as string[];
  const subs = submissionsFor(id);
  const raffle = db().prepare("select * from raffles where question_id = ?").get(id) as RaffleRow | undefined;
  const names = new Map(
    (
      db()
        .prepare(
          "select o.id, o.display_name from observers o join submissions s on s.observer_id = o.id where s.question_id = ?",
        )
        .all(id) as { id: string; display_name: string }[]
    ).map((o) => [o.id, o.display_name]),
  );
  const reputations = computeStats(loadAnswerRows(), loadWinRows(), { now: new Date() });
  const evidence: Evidence[] = await Promise.all(
    subs.map(async (s) => ({
      id: s.id,
      observer_reputation: reputationOf(reputations.get(s.observer_id) ?? EMPTY_STATS),
      answer: options[s.option_index]!,
      option_index: s.option_index,
      free_text: s.free_text ?? undefined,
      image_url: s.image_key ? await imageUrl(s.image_key, origin) : s.image_external_url!,
      distance_m: s.distance_m,
      accuracy_m: s.accuracy_m,
      captured_at: s.captured_at,
      observer: names.get(s.observer_id) ?? "observer",
    })),
  );
  const winner = raffle?.winner_submission_id
    ? evidence.find((e) => e.id === raffle.winner_submission_id)
    : undefined;
  return {
    ...summarize(q),
    tally: tally(options, subs.map((s) => s.option_index)),
    evidence,
    web_baseline: q.web_baseline ? JSON.parse(q.web_baseline) : undefined,
    gallery_url: `${origin}/q/${q.id}`,
    raffle: {
      seed_commit: q.seed_commit,
      seed_reveal: raffle?.seed_reveal,
      entropy_block_hash: raffle?.entropy_block_hash,
      entropy_block_number: raffle?.entropy_block_number ?? undefined,
      winner_submission_id: raffle?.winner_submission_id ?? undefined,
      winner_observer: winner?.observer,
      prize_amount: payoutAmount(q.prize_amount),
      currency: q.currency,
      payout_tx: raffle?.payout_tx ?? undefined,
    },
  };
}

const payoutAmount = (prize: number) => Math.round(prize * (1 - PLATFORM_FEE) * 100) / 100;

// ---------- observer stats & leaderboard ----------

const EMPTY_STATS: ObserverStats = {
  verified_answers: 0,
  questions_won: 0,
  ausd_earned: 0,
  current_streak: 0,
  best_streak: 0,
  agreement_rate: null,
  agreement_scored: 0,
  agreement_agreed: 0,
  badges: [],
};

/** All answers joined to their question's status (closed = not open). */
function loadAnswerRows(): AnswerRow[] {
  const rows = db()
    .prepare(
      `select s.id as submission_id, s.observer_id, s.question_id, s.option_index, s.captured_at,
              q.status as qstatus
         from submissions s join questions q on q.id = s.question_id`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    submission_id: r.submission_id as string,
    observer_id: r.observer_id as string,
    question_id: r.question_id as string,
    option_index: r.option_index as number,
    captured_at: r.captured_at as string,
    closed: (r.qstatus as string) !== "open",
  }));
}

/** Raffle wins joined to their submission; prize = net winner payout. */
function loadWinRows(): WinRow[] {
  const rows = db()
    .prepare(
      `select r.winner_submission_id as submission_id, s.observer_id, s.captured_at, q.prize_amount
         from raffles r
         join submissions s on s.id = r.winner_submission_id
         join questions q on q.id = r.question_id
        where r.winner_submission_id is not null`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    submission_id: r.submission_id as string,
    observer_id: r.observer_id as string,
    captured_at: r.captured_at as string,
    prize: payoutAmount(r.prize_amount as number),
  }));
}

export async function observerStats(observerId: string): Promise<ObserverStats> {
  await settleDue();
  const stats = computeStats(loadAnswerRows(), loadWinRows(), { now: new Date() });
  return stats.get(observerId) ?? EMPTY_STATS;
}

export async function leaderboard(
  range: LeaderboardRange,
  viewerId?: string,
  limit = 25,
): Promise<LeaderboardEntry[]> {
  await settleDue();
  const since = range === "week" ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() : undefined;
  const stats = computeStats(loadAnswerRows(), loadWinRows(), { now: new Date(), since });
  const names = new Map(
    (db().prepare("select id, display_name from observers").all() as { id: string; display_name: string }[]).map(
      (o) => [o.id, o.display_name],
    ),
  );
  return [...stats.entries()]
    .filter(([, s]) => s.verified_answers > 0)
    .map(([observerId, s]) => ({
      ...s,
      display_name: names.get(observerId) ?? "observer",
      is_you: observerId === viewerId,
    }))
    .sort(
      (a, b) =>
        b.verified_answers - a.verified_answers ||
        b.questions_won - a.questions_won ||
        (b.agreement_rate ?? -1) - (a.agreement_rate ?? -1) ||
        a.display_name.localeCompare(b.display_name),
    )
    .slice(0, limit)
    .map((e, i) => ({ rank: i + 1, ...e }));
}

// ---------- submissions ----------

export type SubmitResult =
  | { ok: true; submission_id: string; distance_m: number; closed: boolean }
  | { ok: false; status: number; reason: string; distance_m?: number };

export async function addSubmission(input: {
  question_id: string;
  observer_id: string;
  option_index: number;
  free_text?: string;
  image: { bytes: Uint8Array; type: string };
  lat: number;
  lng: number;
  accuracy_m: number;
  distance_m: number;
  captured_at: string;
}): Promise<SubmitResult> {
  const q = questionById(input.question_id);
  if (!q) return { ok: false, status: 404, reason: "Question not found." };
  if (q.status !== "open" || Date.parse(q.closes_at) <= Date.now())
    return { ok: false, status: 409, reason: "This question has closed." };
  if (input.option_index >= (JSON.parse(q.options) as string[]).length)
    return { ok: false, status: 422, reason: "Pick one of the listed answers." };
  if (db().prepare("select 1 from submissions where question_id = ? and observer_id = ?").get(q.id, input.observer_id))
    return { ok: false, status: 409, reason: "You've already answered this one. One answer per person." };
  const hash = sha256Hex(input.image.bytes);
  if (db().prepare("select 1 from submissions where image_sha256 = ?").get(hash))
    return { ok: false, status: 409, reason: "We've seen this exact photo before. Take a new one." };

  const id = `s_${Date.now().toString(36)}${shortId().slice(0, 4)}`;
  const key = `submissions/${q.id}/${id}.jpg`;
  await putImage(key, input.image.bytes, input.image.type);
  try {
    db()
      .prepare(
        `insert into submissions (id, question_id, observer_id, option_index, free_text, image_key, image_sha256,
           lat, lng, accuracy_m, distance_m, captured_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        q.id,
        input.observer_id,
        input.option_index,
        input.free_text || null,
        key,
        hash,
        input.lat,
        input.lng,
        Math.round(input.accuracy_m),
        input.distance_m,
        input.captured_at,
      );
  } catch (err) {
    // Unique constraints catch a double-tap race on the same person or photo.
    if (String(err).includes("UNIQUE")) return { ok: false, status: 409, reason: "That answer was already recorded." };
    throw err;
  }
  let closed = false;
  if (responseCount(q.id) >= q.max_responses) {
    await settle(q.id);
    closed = true;
  }
  return { ok: true, submission_id: id, distance_m: input.distance_m, closed };
}

export function getQuestionRow(id: string) {
  const q = questionById(id);
  return q ? { id: q.id, lat: q.lat, lng: q.lng, radius_m: q.radius_m } : undefined;
}

// ---------- push subscriptions ----------

export type PushSubscriptionRecord = {
  endpoint: string;
  observer_id: string;
  p256dh: string;
  auth: string;
  lat: number | null;
  lng: number | null;
  location_at: string | null;
  last_push_at: string | null;
  created_at: string;
};

/** Upsert on endpoint. A new lat/lng is stored rounded to 3 decimals (~110 m); omitting it keeps the old fix. */
export function savePushSubscription(input: {
  observerId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lat?: number;
  lng?: number;
}): PushSubscriptionRecord {
  const now = new Date().toISOString();
  const hasLoc = input.lat !== undefined && input.lng !== undefined;
  const lat = hasLoc ? Math.round(input.lat! * 1000) / 1000 : null;
  const lng = hasLoc ? Math.round(input.lng! * 1000) / 1000 : null;
  db()
    .prepare(
      `insert into push_subscriptions (endpoint, observer_id, p256dh, auth, lat, lng, location_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(endpoint) do update set
         observer_id = excluded.observer_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         lat = coalesce(excluded.lat, push_subscriptions.lat),
         lng = coalesce(excluded.lng, push_subscriptions.lng),
         location_at = coalesce(excluded.location_at, push_subscriptions.location_at)`,
    )
    .run(input.endpoint, input.observerId, input.p256dh, input.auth, lat, lng, hasLoc ? now : null, now);
  return db().prepare("select * from push_subscriptions where endpoint = ?").get(input.endpoint) as PushSubscriptionRecord;
}

export function deletePushSubscription(endpoint: string): boolean {
  return db().prepare("delete from push_subscriptions where endpoint = ?").run(endpoint).changes === 1;
}

/** SQL bounding-box prefilter (same math as nearbyQuestions); exact distance filtering is selectPushTargets. */
export function pushSubscriptionsNear(lat: number, lng: number, radiusM: number): PushSubscriptionRecord[] {
  const dLat = radiusM / 1000 / 111.32;
  const dLng = radiusM / 1000 / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return db()
    .prepare(
      "select * from push_subscriptions where lat is not null and lat between ? and ? and lng between ? and ?",
    )
    .all(lat - dLat, lat + dLat, lng - dLng, lng + dLng) as PushSubscriptionRecord[];
}

/** Rate limit + no double send: one atomic UPDATE claims the slot for `now`. */
export function claimPushSlot(endpoint: string, nowMs: number, minIntervalMs: number): boolean {
  const res = db()
    .prepare(
      "update push_subscriptions set last_push_at = ? where endpoint = ? and (last_push_at is null or last_push_at <= ?)",
    )
    .run(new Date(nowMs).toISOString(), endpoint, new Date(nowMs - minIntervalMs).toISOString());
  return res.changes === 1;
}

// ---------- settle ----------

export async function settleDue(): Promise<number> {
  const due = db()
    .prepare("select id from questions where status = 'open' and closes_at <= ?")
    .all(new Date().toISOString()) as { id: string }[];
  let settled = 0;
  for (const { id } of due) {
    if (await settle(id)) settled += 1;
  }
  return settled;
}

export async function closeNow(id: string) {
  return settle(id);
}

/**
 * Close → tally → raffle. The conditional UPDATE claims the question, so two
 * requests (or two processes) can never both draw a winner.
 */
async function settle(id: string) {
  const claim = db().prepare("update questions set status = 'closed' where id = ? and status = 'open'").run(id);
  if (claim.changes !== 1) return false;
  const q = questionById(id)!;
  const subs = submissionsFor(id);
  if (subs.length < q.min_responses) {
    db().prepare("update questions set status = 'expired' where id = ?").run(id);
    // Only questions that were actually paid over x402 are refunded.
    if (q.payment_tx && q.payer_address) {
      const refund = await sendFromTreasury("refund", q.payer_address, prizeUnits(q.prize_amount));
      if (refund) db().prepare("update questions set refund_tx = ? where id = ?").run(refund, id);
    }
    trackWebhook(id);
    return true;
  }
  const block = await latestBlock();
  const entropy = block?.hash ?? `offline:${sha256Hex(q.closes_at)}`;
  const draw = drawWinner(q.seed, entropy, q.id, subs.map((s) => s.id));
  db()
    .prepare(
      `insert into raffles (question_id, seed_reveal, entropy_block_hash, entropy_block_number, winner_submission_id)
       values (?, ?, ?, ?, ?)`,
    )
    .run(id, q.seed, entropy, block?.number ?? null, draw?.winner ?? null);
  db().prepare("update questions set status = 'settled' where id = ?").run(id);
  if (q.payment_tx && draw?.winner) await payWinner(id, draw.winner, q.prize_amount);
  trackWebhook(id);
  return true;
}

const pendingWebhooks = new Set<Promise<void>>();

function trackWebhook(id: string) {
  const pending = deliverWebhook(id);
  pendingWebhooks.add(pending);
  void pending.then(
    () => pendingWebhooks.delete(pending),
    () => pendingWebhooks.delete(pending),
  );
}

export async function flushWebhooks(): Promise<void> {
  await Promise.all([...pendingWebhooks]);
}

async function deliverWebhook(id: string): Promise<void> {
  try {
    const row = db()
      .prepare("select webhook_url, webhook_origin from questions where id = ?")
      .get(id) as { webhook_url: string | null; webhook_origin: string | null } | undefined;
    if (!row?.webhook_url) return;
    const claim = db()
      .prepare(
        "update questions set webhook_state = 'sending' where id = ? and webhook_url is not null and webhook_state is null",
      )
      .run(id);
    if (claim.changes !== 1) return;

    const payload = await buildResults(
      id,
      row.webhook_origin ?? process.env.A_EYE_PUBLIC_URL ?? "http://localhost:3000",
    );
    if (!payload) throw new Error("question results not found");
    const result = await postWebhook(row.webhook_url, payload);
    db()
      .prepare("update questions set webhook_state = ? where id = ?")
      .run(result.ok ? "delivered" : "failed", id);
    if (!result.ok) console.warn(`[webhook] delivery failed for ${id}: ${(result.error ?? "unknown error").replace(/\s+/g, " ")}`);
  } catch (err) {
    try {
      db().prepare("update questions set webhook_state = 'failed' where id = ? and webhook_state = 'sending'").run(id);
    } catch {}
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[webhook] delivery failed for ${id}: ${message.replace(/\s+/g, " ")}`);
  }
}

/** Treasury pays the raffle winner (prize minus the platform fee) to their EVM payout address. */
async function payWinner(questionId: string, winnerSubmissionId: string, prizeUsd: number) {
  const winner = db()
    .prepare("select o.evm_address from submissions s join observers o on o.id = s.observer_id where s.id = ?")
    .get(winnerSubmissionId) as { evm_address: string | null } | undefined;
  if (!winner?.evm_address) {
    console.warn(`[payments] winner of ${questionId} has no payout address; payout pending`);
    return;
  }
  const tx = await sendFromTreasury("payout", winner.evm_address, winnerPayoutUnits(prizeUsd));
  if (tx) db().prepare("update raffles set payout_tx = ? where question_id = ?").run(tx, questionId);
}

// ---------- seed data (mock demo questions around the UC Berkeley campus) ----------

function seed(conn: DatabaseSync) {
  const now = Date.now();
  const iso = (offsetMin: number) => new Date(now + offsetMin * 60_000).toISOString();
  const names = ["Priya Raman", "Tomás Ibarra", "Wen Okafor", "Dani Kessler", "Hollis Park", "Mateo Lindqvist", "Ayumi Oduya"];
  const insObs = conn.prepare("insert or ignore into observers (id, display_name, created_at) values (?, ?, ?)");
  names.forEach((n, i) => insObs.run(`seed-obs-${i}`, n, iso(-600)));

  const insQ = conn.prepare(
    `insert into questions (id, agent_label, prompt, options, allow_free_text, place_label, lat, lng, radius_m,
       prize_amount, currency, min_responses, max_responses, closes_at, created_at, status, seed, seed_commit, web_baseline)
     values (?, 'seed', ?, ?, ?, ?, ?, ?, ?, ?, 'AUSD', ?, ?, ?, ?, 'open', ?, ?, ?)`,
  );
  const insS = conn.prepare(
    `insert into submissions (id, question_id, observer_id, option_index, free_text, image_external_url, image_sha256,
       lat, lng, accuracy_m, distance_m, captured_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const add = (q: {
    id: string;
    prompt: string;
    options: string[];
    free_text: boolean;
    place: string;
    lat: number;
    lng: number;
    radius_m: number;
    prize: number;
    min: number;
    max: number;
    created: number;
    closes: number;
    baseline: { answer: string; source: string };
    answers: { option: number; dist: number; minAgo: number; img: string; text?: string; obs?: number }[];
  }) => {
    const { seed: s, commit } = newSeed();
    insQ.run(
      q.id, q.prompt, JSON.stringify(q.options), q.free_text ? 1 : 0, q.place, q.lat, q.lng, q.radius_m,
      q.prize, q.min, q.max, iso(q.closes), iso(q.created), s, commit, JSON.stringify(q.baseline),
    );
    q.answers.forEach((a, i) => {
      insS.run(
        `s_seed_${q.id}_${i}`, q.id, `seed-obs-${a.obs ?? i % names.length}`, a.option, a.text ?? null,
        `https://picsum.photos/seed/${a.img}/720/900`, sha256Hex(a.img), q.lat, q.lng,
        8 + ((i * 7) % 20), a.dist, iso(-a.minAgo),
      );
    });
  };

  add({
    id: "sproul-cart",
    prompt: "Is there a line at the coffee cart on Sproul Plaza?",
    options: ["No line", "1 to 5 people", "6 or more"],
    free_text: true,
    place: "Sproul Plaza",
    lat: 37.86967,
    lng: -122.25913,
    radius_m: 150,
    prize: 2,
    min: 3,
    max: 20,
    created: -14,
    closes: 26,
    baseline: { answer: "Open 7am to 4pm, no live wait data", source: "Business listing (mock)" },
    answers: [
      { option: 1, dist: 22, minAgo: 11, img: "aeye-sproul-coffee-line-1", text: "Three people, moving fast" },
      { option: 1, dist: 41, minAgo: 9, img: "aeye-sproul-coffee-line-2" },
      { option: 2, dist: 17, minAgo: 6, img: "aeye-sproul-coffee-line-3", text: "Club fair just let out" },
      { option: 1, dist: 63, minAgo: 2, img: "aeye-sproul-coffee-line-4" },
    ],
  });

  add({
    id: "glade-wet",
    prompt: "Is the grass on Memorial Glade wet right now?",
    options: ["Dry", "Damp", "Soaked"],
    free_text: false,
    place: "Memorial Glade",
    lat: 37.87322,
    lng: -122.25947,
    radius_m: 200,
    prize: 5,
    min: 3,
    max: 12,
    created: -75,
    closes: -15,
    baseline: { answer: "Forecast says 0% rain today", source: "Weather forecast (mock)" },
    answers: [
      { option: 1, dist: 34, minAgo: 70, img: "aeye-glade-lawn-1" },
      { option: 1, dist: 58, minAgo: 66, img: "aeye-glade-lawn-2" },
      { option: 2, dist: 12, minAgo: 61, img: "aeye-glade-lawn-3" },
      { option: 1, dist: 91, minAgo: 52, img: "aeye-glade-lawn-4" },
      { option: 0, dist: 140, minAgo: 47, img: "aeye-glade-lawn-5" },
      { option: 1, dist: 27, minAgo: 38, img: "aeye-glade-lawn-6" },
      { option: 1, dist: 73, minAgo: 29, img: "aeye-glade-lawn-7" },
    ],
  });

  add({
    id: "moffitt-door",
    prompt: "Is the Moffitt Library entrance open?",
    options: ["Open", "Closed", "Can't tell"],
    free_text: false,
    place: "Moffitt Library",
    lat: 37.87253,
    lng: -122.26076,
    radius_m: 120,
    prize: 1,
    min: 2,
    max: 10,
    created: -3,
    closes: 42,
    baseline: { answer: "Listed as open 24 hours", source: "Library website (mock)" },
    answers: [],
  });

  // Demo history: past questions (still 'open' with closes_at in the past, so
  // settleDue closes and raffles them on first read) give observers streaks,
  // agreement records and badges. Priya (obs 0) answered every day 1-4 ago
  // plus today, always with the majority -> 5-day streak + Sharpshooter.
  // Noor (obs 7) answered days 1-3 ago only -> 3-day streak. Tomas (obs 1)
  // splits right/wrong -> ~50% agreement. Ayumi (obs 6) only answered today.
  insObs.run("seed-obs-7", "Noor Haddad", iso(-600));
  const day = 24 * 60;

  add({
    id: "hist-campanile",
    prompt: "How busy is the Campanile esplanade?",
    options: ["Empty", "A few people", "Packed"],
    free_text: false,
    place: "Campanile Esplanade",
    lat: 37.87203,
    lng: -122.25783,
    radius_m: 120,
    prize: 1,
    min: 3,
    max: 10,
    created: -(day + 700),
    closes: -(day + 60),
    baseline: { answer: "No live occupancy data", source: "Campus events page (mock)" },
    answers: [
      { option: 1, dist: 31, minAgo: day + 300, img: "aeye-hist-campanile-1", obs: 0 },
      { option: 1, dist: 44, minAgo: day + 260, img: "aeye-hist-campanile-2", obs: 1 },
      { option: 1, dist: 18, minAgo: day + 200, img: "aeye-hist-campanile-3", obs: 2 },
      { option: 1, dist: 57, minAgo: day + 150, img: "aeye-hist-campanile-4", obs: 7 },
    ],
  });

  add({
    id: "hist-doe",
    prompt: "Is the Doe Library reading room quiet right now?",
    options: ["Silent", "Some chatter", "Loud"],
    free_text: false,
    place: "Doe Library",
    lat: 37.87222,
    lng: -122.25942,
    radius_m: 100,
    prize: 1,
    min: 3,
    max: 10,
    created: -(2 * day + 700),
    closes: -(2 * day + 60),
    baseline: { answer: "Reading rooms are quiet zones", source: "Library policy (mock)" },
    answers: [
      { option: 0, dist: 12, minAgo: 2 * day + 320, img: "aeye-hist-doe-1", obs: 0 },
      { option: 0, dist: 25, minAgo: 2 * day + 240, img: "aeye-hist-doe-2", obs: 2 },
      { option: 0, dist: 39, minAgo: 2 * day + 180, img: "aeye-hist-doe-3", obs: 3 },
      { option: 0, dist: 8, minAgo: 2 * day + 120, img: "aeye-hist-doe-4", obs: 7 },
    ],
  });

  add({
    id: "hist-soda",
    prompt: "Are there free tables outside Soda Hall?",
    options: ["Plenty free", "One or two", "None"],
    free_text: false,
    place: "Soda Hall",
    lat: 37.87552,
    lng: -122.25879,
    radius_m: 120,
    prize: 1,
    min: 3,
    max: 10,
    created: -(3 * day + 700),
    closes: -(3 * day + 60),
    baseline: { answer: "No live occupancy data", source: "Building page (mock)" },
    answers: [
      { option: 2, dist: 21, minAgo: 3 * day + 300, img: "aeye-hist-soda-1", obs: 0 },
      { option: 2, dist: 33, minAgo: 3 * day + 250, img: "aeye-hist-soda-2", obs: 1 },
      { option: 2, dist: 48, minAgo: 3 * day + 200, img: "aeye-hist-soda-3", obs: 7 },
      { option: 0, dist: 60, minAgo: 3 * day + 160, img: "aeye-hist-soda-4", obs: 3 },
    ],
  });

  add({
    id: "hist-strada",
    prompt: "Is the Caffe Strada patio full?",
    options: ["Empty", "Half full", "Full"],
    free_text: false,
    place: "Caffe Strada",
    lat: 37.86937,
    lng: -122.25476,
    radius_m: 100,
    prize: 1,
    min: 3,
    max: 10,
    created: -(4 * day + 700),
    closes: -(4 * day + 60),
    baseline: { answer: "Opens 6:30am daily", source: "Business listing (mock)" },
    answers: [
      { option: 1, dist: 15, minAgo: 4 * day + 310, img: "aeye-hist-strada-1", obs: 0 },
      { option: 1, dist: 29, minAgo: 4 * day + 260, img: "aeye-hist-strada-2", obs: 2 },
      { option: 0, dist: 41, minAgo: 4 * day + 210, img: "aeye-hist-strada-3", obs: 1 },
      { option: 1, dist: 52, minAgo: 4 * day + 170, img: "aeye-hist-strada-4", obs: 3 },
    ],
  });
}

// ---------- agents and coverage ----------

export async function questionsByAgent(agentLabel: string, origin: string) {
  const rows = db()
    .prepare("select id from questions where agent_label = ? order by created_at desc limit 50")
    .all(agentLabel) as { id: string }[];
  const results = await Promise.all(rows.map((r) => getResults(r.id, origin)));
  return results.filter((r): r is QuestionResults => Boolean(r));
}

/** Distinct observers who submitted near a point recently: a proxy for who is around to answer. */
export function coverage(lat: number, lng: number, radiusM = 1000, windowMinutes = 60) {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const rows = db()
    .prepare(
      `select observer_id, lat, lng from submissions
        where captured_at >= ? and lat between ? and ? and lng between ? and ?`,
    )
    .all(since, lat - dLat, lat + dLat, lng - dLng, lng + dLng) as { observer_id: string; lat: number; lng: number }[];
  const near = new Set(rows.filter((r) => distanceM(lat, lng, r.lat, r.lng) <= radiusM).map((r) => r.observer_id));
  return { active_observers: near.size, window_minutes: windowMinutes, radius_m: radiusM };
}
