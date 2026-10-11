import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  PLATFORM_FEE,
  type CreateQuestionInput,
  type PayoutRail,
  type Evidence,
  type MarketRef,
  type QuestionResults,
  type QuestionStatus,
  type QuestionSummary,
  type WebBaseline,
  type XrplPotInfo,
} from "@a-eye/shared";
import { distanceM } from "./geo";
import { drawWinner, latestBlock, newSeed, sha256Hex } from "./raffle";
import { prizeUnits, sendFromTreasury, winnerPayoutUnits } from "./payments";
import { imageUrl, putImage } from "./storage";
import { tally } from "./tally";
import { explorerTxUrl } from "./chain";
import {
  XrplError,
  cancelEscrow,
  createPotEscrow,
  dropsToXrpString,
  explorerTx,
  finishEscrow,
  isXrplConfigured,
  issueObserverCredential,
  payoutXrp,
  potXrpForUsd,
} from "./xrpl";

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
  xrpl_address?: string;
  payout_rail: PayoutRail;
  created_at: string;
};

type XrplEscrowRow = {
  question_id: string;
  owner: string;
  offer_sequence: number;
  amount_drops: string;
  escrow_tx: string;
  finish_after: string;
  cancel_after: string;
  state: "escrowed" | "settling" | "finished" | "canceled";
  attempted_at: string | null;
  finish_tx: string | null;
  cancel_tx: string | null;
  payout_tx: string | null;
  payout_address: string | null;
  last_error: string | null;
};

const SCHEMA = `
create table if not exists observers (
  id text primary key,
  display_name text not null,
  evm_address text,
  xrpl_address text,
  payout_rail text not null default 'evm',
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
  market_ref text
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
create table if not exists xrpl_escrows (
  question_id text primary key references questions(id),
  owner text not null,
  offer_sequence integer not null,
  amount_drops text not null,
  escrow_tx text not null,
  finish_after text not null,
  cancel_after text not null,
  state text not null default 'escrowed',
  attempted_at text,
  finish_tx text,
  cancel_tx text,
  payout_tx text,
  payout_address text,
  last_error text
);
create table if not exists xrpl_credentials (
  observer_id text not null references observers(id),
  subject text not null,
  state text not null,
  tx text,
  updated_at text not null,
  primary key (observer_id, subject)
);
`;

const g = globalThis as unknown as { __aeyeDb?: DatabaseSync };

/** Columns added after the first deploy; `create table if not exists` won't add them to an existing file. */
function migrate(conn: DatabaseSync) {
  const cols = new Set((conn.prepare("pragma table_info(questions)").all() as { name: string }[]).map((c) => c.name));
  for (const col of ["payer_address", "payment_tx", "refund_tx", "market_ref"]) {
    if (!cols.has(col)) conn.exec(`alter table questions add column ${col} text`);
  }
  const obsCols = new Set((conn.prepare("pragma table_info(observers)").all() as { name: string }[]).map((c) => c.name));
  if (!obsCols.has("xrpl_address")) conn.exec("alter table observers add column xrpl_address text");
  if (!obsCols.has("payout_rail")) conn.exec("alter table observers add column payout_rail text not null default 'evm'");
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
    xrpl_address: (row.xrpl_address as string | null) ?? undefined,
    payout_rail: row.payout_rail === "xrpl" ? "xrpl" : "evm",
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
    payout_rail: "evm",
    created_at: new Date().toISOString(),
  };
  db()
    .prepare("insert into observers (id, display_name, created_at) values (?, ?, ?)")
    .run(obs.id, obs.display_name, obs.created_at);
  return obs;
}

export function updateObserver(
  id: string,
  patch: { display_name?: string; evm_address?: string | null; xrpl_address?: string | null; payout_rail?: PayoutRail },
) {
  const obs = getOrCreateObserver(id);
  const next = {
    display_name: patch.display_name ?? obs.display_name,
    evm_address: patch.evm_address === undefined ? obs.evm_address ?? null : patch.evm_address,
    xrpl_address: patch.xrpl_address === undefined ? obs.xrpl_address ?? null : patch.xrpl_address,
    payout_rail: patch.payout_rail ?? obs.payout_rail,
  };
  db()
    .prepare("update observers set display_name = ?, evm_address = ?, xrpl_address = ?, payout_rail = ? where id = ?")
    .run(next.display_name, next.evm_address, next.xrpl_address, next.payout_rail, id);
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
) {
  const { seed: s, commit } = newSeed();
  const now = Date.now();
  const id = shortId();
  db()
    .prepare(
      `insert into questions (id, agent_label, prompt, options, allow_free_text, place_label, lat, lng, radius_m,
         prize_amount, currency, min_responses, max_responses, closes_at, created_at, status, seed, seed_commit,
         payer_address, payment_tx, market_ref)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUSD', ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
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
  const evidence: Evidence[] = await Promise.all(
    subs.map(async (s) => ({
      id: s.id,
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
      payout_url: raffle?.payout_tx ? explorerTxUrl(raffle.payout_tx) : undefined,
      xrpl: xrplPotInfo(id),
    },
  };
}

const payoutAmount = (prize: number) => Math.round(prize * (1 - PLATFORM_FEE) * 100) / 100;

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
  void maybeIssueObserverCredential(input.observer_id).catch((err) =>
    console.error("[xrpl] credential check failed:", err instanceof Error ? err.message : err),
  );
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

// ---------- settle ----------

async function settleDue() {
  const due = db()
    .prepare("select id from questions where status = 'open' and closes_at <= ?")
    .all(new Date().toISOString()) as { id: string }[];
  for (const { id } of due) await settle(id);
  retryXrplPots();
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
    await settleXrplPot(id);
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
  const xrplWinner = draw?.winner ? xrplPayoutAddress(draw.winner) : undefined;
  const escrowed = Boolean(escrowRow(id));
  // An XRPL-rail winner of an escrowed pot is paid from the escrow instead of in AUSD.
  if (q.payment_tx && draw?.winner && !(escrowed && xrplWinner)) await payWinner(id, draw.winner, q.prize_amount);
  await settleXrplPot(id);
  return true;
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

// ---------- XRPL testnet: pot escrows and observer credentials ----------

const XRPL_FINISH_DELAY_MS = 10_000;
const XRPL_CANCEL_GRACE_MS = 2 * 60_000;
const XRPL_LEDGER_SLACK_MS = 5_000;
const XRPL_RETRY_MS = 30_000;
const XRPL_STALE_CLAIM_MS = 5 * 60_000;
export const CREDENTIAL_THRESHOLD = 3;

const escrowRow = (questionId: string) =>
  db().prepare("select * from xrpl_escrows where question_id = ?").get(questionId) as XrplEscrowRow | undefined;

const xrplError = (err: unknown) =>
  err instanceof XrplError ? err.code : err instanceof Error ? err.message.slice(0, 120) : "xrpl_failed";

function xrplPayoutAddress(winnerSubmissionId: string): string | undefined {
  const row = db()
    .prepare("select o.payout_rail, o.xrpl_address from submissions s join observers o on o.id = s.observer_id where s.id = ?")
    .get(winnerSubmissionId) as { payout_rail: string | null; xrpl_address: string | null } | undefined;
  return row?.payout_rail === "xrpl" && row.xrpl_address ? row.xrpl_address : undefined;
}

/**
 * Lock the question's pot (the winner payout, in testnet XRP) in an EscrowCreate owned by the
 * XRPL treasury. FinishAfter is a few seconds out so early closes can release it; CancelAfter is
 * just past closes_at so an expired question's pot can be refunded. Never throws.
 */
export async function escrowQuestionPot(questionId: string): Promise<string | null> {
  if (!isXrplConfigured()) return null;
  const q = questionById(questionId);
  if (!q || q.status !== "open") return null;
  const existing = escrowRow(questionId);
  if (existing) return existing.escrow_tx;
  const finishAfter = new Date(Date.now() + XRPL_FINISH_DELAY_MS);
  const cancelAfter = new Date(Math.max(Date.parse(q.closes_at), finishAfter.getTime()) + XRPL_CANCEL_GRACE_MS);
  try {
    const escrow = await createPotEscrow(potXrpForUsd(payoutAmount(q.prize_amount)), finishAfter, { cancelAfter });
    db()
      .prepare(
        `insert into xrpl_escrows (question_id, owner, offer_sequence, amount_drops, escrow_tx, finish_after, cancel_after)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        questionId,
        escrow.owner,
        escrow.offer_sequence,
        escrow.amount_drops,
        escrow.hash,
        finishAfter.toISOString(),
        cancelAfter.toISOString(),
      );
    console.info(`[xrpl] pot escrow for ${questionId}: ${escrow.explorer_url}`);
    return escrow.hash;
  } catch (err) {
    console.error(`[xrpl] pot escrow for ${questionId} failed: ${xrplError(err)}`);
    return null;
  }
}

/**
 * Release a closed question's escrow: EscrowCancel (refund to the treasury) when it expired,
 * otherwise EscrowFinish and, if the winner chose the XRPL rail, an XRP payment to them.
 * Each step is persisted, so a failed or early attempt is retried by a later settleDue().
 */
export async function settleXrplPot(questionId: string): Promise<void> {
  if (!isXrplConfigured()) return;
  const row = escrowRow(questionId);
  const q = questionById(questionId);
  if (!row || !q || row.state === "finished" || row.state === "canceled") return;
  if (q.status !== "settled" && q.status !== "expired") return;
  const now = Date.now();
  const cancelable = now >= Date.parse(row.cancel_after) + XRPL_LEDGER_SLACK_MS;
  if (q.status === "expired" && !cancelable) return;
  if (q.status === "settled" && now < Date.parse(row.finish_after) + XRPL_LEDGER_SLACK_MS) return;
  const claim = db()
    .prepare(
      `update xrpl_escrows set state = 'settling', attempted_at = ?
        where question_id = ?
          and ((state = 'escrowed' and (attempted_at is null or attempted_at < ?)) or (state = 'settling' and attempted_at < ?))`,
    )
    .run(
      new Date(now).toISOString(),
      questionId,
      new Date(now - XRPL_RETRY_MS).toISOString(),
      new Date(now - XRPL_STALE_CLAIM_MS).toISOString(),
    );
  if (claim.changes !== 1) return;

  const set = (col: "finish_tx" | "cancel_tx" | "payout_tx" | "payout_address", value: string) =>
    db().prepare(`update xrpl_escrows set ${col} = ? where question_id = ?`).run(value, questionId);
  try {
    if (q.status === "expired") {
      if (!row.cancel_tx) set("cancel_tx", (await cancelEscrow({ owner: row.owner, offerSequence: row.offer_sequence })).hash);
      db().prepare("update xrpl_escrows set state = 'canceled', last_error = null where question_id = ?").run(questionId);
      return;
    }
    const raffle = db().prepare("select winner_submission_id from raffles where question_id = ?").get(questionId) as
      | { winner_submission_id: string | null }
      | undefined;
    const payTo = raffle?.winner_submission_id ? xrplPayoutAddress(raffle.winner_submission_id) : undefined;
    if (!row.finish_tx && !row.cancel_tx) {
      // Past CancelAfter the escrow can no longer be finished; cancel it back to the treasury instead.
      if (cancelable) set("cancel_tx", (await cancelEscrow({ owner: row.owner, offerSequence: row.offer_sequence })).hash);
      else set("finish_tx", (await finishEscrow({ owner: row.owner, offerSequence: row.offer_sequence })).finish.hash);
    }
    if (payTo && !row.payout_tx) {
      set("payout_address", payTo);
      set("payout_tx", (await payoutXrp(payTo, row.amount_drops)).hash);
    }
    db().prepare("update xrpl_escrows set state = 'finished', last_error = null where question_id = ?").run(questionId);
  } catch (err) {
    const code = xrplError(err);
    console.error(`[xrpl] settling pot for ${questionId} failed: ${code}`);
    db().prepare("update xrpl_escrows set state = 'escrowed', last_error = ? where question_id = ?").run(code, questionId);
  }
}

/** Background retry for pots whose release was too early or failed; never blocks the caller. */
function retryXrplPots() {
  if (!isXrplConfigured()) return;
  const pending = db()
    .prepare(
      `select e.question_id from xrpl_escrows e join questions q on q.id = e.question_id
        where e.state in ('escrowed', 'settling') and q.status in ('settled', 'expired')`,
    )
    .all() as { question_id: string }[];
  for (const { question_id } of pending) {
    void settleXrplPot(question_id).catch((err) => console.error(`[xrpl] retry ${question_id}: ${xrplError(err)}`));
  }
}

function xrplPotInfo(questionId: string): XrplPotInfo | undefined {
  const row = escrowRow(questionId);
  if (!row) return undefined;
  const tx = (hash: string | null) => (hash ? { hash, url: explorerTx(hash) } : undefined);
  const finish = tx(row.finish_tx);
  const cancel = tx(row.cancel_tx);
  const payout = tx(row.payout_tx);
  return {
    state: row.state,
    amount_xrp: dropsToXrpString(row.amount_drops),
    owner: row.owner,
    offer_sequence: row.offer_sequence,
    escrow_tx: row.escrow_tx,
    escrow_url: explorerTx(row.escrow_tx),
    finish_tx: finish?.hash,
    finish_url: finish?.url,
    cancel_tx: cancel?.hash,
    cancel_url: cancel?.url,
    payout_tx: payout?.hash,
    payout_url: payout?.url,
  };
}

const acceptedSubmissions = (observerId: string) =>
  (db().prepare("select count(*) as n from submissions where observer_id = ?").get(observerId) as { n: number }).n;

export type ObserverCredential = {
  enabled: boolean;
  accepted: number;
  threshold: number;
  credential?: { subject: string; state: "pending" | "issued" | "failed"; tx?: string; url?: string };
};

export function observerCredential(observerId: string): ObserverCredential {
  const obs = getOrCreateObserver(observerId);
  const row = obs.xrpl_address
    ? (db()
        .prepare("select subject, state, tx from xrpl_credentials where observer_id = ? and subject = ?")
        .get(observerId, obs.xrpl_address) as { subject: string; state: "pending" | "issued" | "failed"; tx: string | null } | undefined)
    : undefined;
  return {
    enabled: isXrplConfigured(),
    accepted: acceptedSubmissions(observerId),
    threshold: CREDENTIAL_THRESHOLD,
    credential: row
      ? { subject: row.subject, state: row.state, tx: row.tx ?? undefined, url: row.tx ? explorerTx(row.tx) : undefined }
      : undefined,
  };
}

/** CredentialCreate "A-eye Verified Observer" once an observer with an XRPL address has 3 accepted answers. */
export async function maybeIssueObserverCredential(observerId: string): Promise<void> {
  if (!isXrplConfigured()) return;
  const obs = getOrCreateObserver(observerId);
  const subject = obs.xrpl_address;
  if (!subject || acceptedSubmissions(observerId) < CREDENTIAL_THRESHOLD) return;
  const now = new Date();
  const claimed =
    db()
      .prepare("insert or ignore into xrpl_credentials (observer_id, subject, state, updated_at) values (?, ?, 'pending', ?)")
      .run(observerId, subject, now.toISOString()).changes === 1 ||
    db()
      .prepare(
        `update xrpl_credentials set state = 'pending', updated_at = ?
          where observer_id = ? and subject = ? and state = 'failed' and updated_at < ?`,
      )
      .run(now.toISOString(), observerId, subject, new Date(now.getTime() - XRPL_RETRY_MS).toISOString()).changes === 1;
  if (!claimed) return;
  try {
    const issued = await issueObserverCredential(subject);
    db()
      .prepare("update xrpl_credentials set state = 'issued', tx = ?, updated_at = ? where observer_id = ? and subject = ?")
      .run(issued.hash, new Date().toISOString(), observerId, subject);
    if (issued.explorer_url) console.info(`[xrpl] credential for ${subject}: ${issued.explorer_url}`);
  } catch (err) {
    console.error(`[xrpl] credential for ${subject} failed: ${xrplError(err)}`);
    db()
      .prepare("update xrpl_credentials set state = 'failed', updated_at = ? where observer_id = ? and subject = ?")
      .run(new Date().toISOString(), observerId, subject);
  }
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
    answers: { option: number; dist: number; minAgo: number; img: string; text?: string }[];
  }) => {
    const { seed: s, commit } = newSeed();
    insQ.run(
      q.id, q.prompt, JSON.stringify(q.options), q.free_text ? 1 : 0, q.place, q.lat, q.lng, q.radius_m,
      q.prize, q.min, q.max, iso(q.closes), iso(q.created), s, commit, JSON.stringify(q.baseline),
    );
    q.answers.forEach((a, i) => {
      insS.run(
        `s_seed_${q.id}_${i}`, q.id, `seed-obs-${i % names.length}`, a.option, a.text ?? null,
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
