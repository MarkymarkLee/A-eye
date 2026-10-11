import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  PLATFORM_FEE,
  type CreateQuestionInput,
  type Evidence,
  type QuestionResults,
  type QuestionStatus,
  type QuestionSummary,
} from "@a-eye/shared";
import { distanceM } from "./geo";
import { drawWinner, latestBlock, newSeed, sha256Hex } from "./raffle";
import { imageUrl, putImage } from "./storage";
import { tally } from "./tally";

/*
 * Local SQLite database (node:sqlite, no native build). Tables follow
 * PLAN.md: questions, submissions, raffles, observers. Photos live in S3
 * (see storage.ts); rows keep only the object key and its SHA-256.
 */

type QuestionRow = {
  id: string;
  agent_label: string;
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
  web_baseline text
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
`;

const g = globalThis as unknown as { __aeyeDb?: DatabaseSync };

function db(): DatabaseSync {
  if (!g.__aeyeDb) {
    const file = process.env.A_EYE_DB_PATH ?? path.join(process.cwd(), ".data", "a-eye.db");
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    const conn = new DatabaseSync(file);
    conn.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    conn.exec(SCHEMA);
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

export function createQuestion(input: CreateQuestionInput, agentLabel = "unpaid-dev-agent") {
  const { seed: s, commit } = newSeed();
  const now = Date.now();
  const id = shortId();
  db()
    .prepare(
      `insert into questions (id, agent_label, prompt, options, allow_free_text, place_label, lat, lng, radius_m,
         prize_amount, currency, min_responses, max_responses, closes_at, created_at, status, seed, seed_commit)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUSD', ?, ?, ?, ?, 'open', ?, ?)`,
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
    );
  return id;
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
    // TODO(milestone 3): refund the agent's AUSD payment.
    db().prepare("update questions set status = 'expired' where id = ?").run(id);
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
  // TODO(milestone 3): treasury pays the winner in AUSD on Base Sepolia, store payout_tx.
  db().prepare("update questions set status = 'settled' where id = ?").run(id);
  return true;
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
