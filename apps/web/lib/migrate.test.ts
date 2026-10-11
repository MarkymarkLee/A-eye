import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Original schema from commit c0797dd (before payer/webhook/xrpl/treasury columns existed).
const OLD_SCHEMA = `
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

const dir = mkdtempSync(path.join(tmpdir(), "a-eye-migrate-"));
const dbFile = path.join(dir, "old.db");
{
  const conn = new DatabaseSync(dbFile);
  conn.exec(OLD_SCHEMA);
  conn
    .prepare("insert into observers (id, display_name, created_at) values (?, ?, ?)")
    .run("old-obs", "Old Observer", new Date().toISOString());
  conn
    .prepare(
      `insert into questions (id, agent_label, prompt, options, allow_free_text, place_label, lat, lng, radius_m,
         prize_amount, currency, min_responses, max_responses, closes_at, created_at, status, seed, seed_commit, web_baseline)
       values (?, 'old-agent', ?, ?, 0, ?, ?, ?, ?, ?, 'AUSD', ?, ?, ?, ?, 'open', ?, ?, null)`,
    )
    .run(
      "old-q",
      "Is the old question still answerable?",
      JSON.stringify(["Yes", "No"]),
      "Old Place",
      37.8716,
      -122.2536,
      150,
      1.5,
      1,
      5,
      new Date(Date.now() + 60 * 60_000).toISOString(),
      new Date().toISOString(),
      "seed",
      "commit",
    );
  conn
    .prepare(
      `insert into submissions (id, question_id, observer_id, option_index, image_external_url, image_sha256,
         lat, lng, accuracy_m, distance_m, captured_at)
       values ('old-sub', 'old-q', 'old-obs', 0, 'https://example.com/p.jpg', 'oldhash', 37.8716, -122.2536, 5, 0, ?)`,
    )
    .run(new Date().toISOString());
  conn.close();
}

vi.stubEnv("A_EYE_DB_PATH", dbFile);
vi.stubEnv("A_EYE_UPLOAD_DIR", path.join(dir, "up"));
vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", "");
vi.stubEnv("A_EYE_TREASURY_ADDRESS", "");
vi.stubEnv("XRPL_TREASURY_SEED", "");
vi.stubEnv("XRPL_ISSUER_SEED", "");

const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("offline");
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

const store = await import("./store");

describe("schema migration from the original deploy", () => {
  it("reads old rows, adds new columns and tables, and keeps working", async () => {
    const results = (await store.getResults("old-q", "http://a-eye.test"))!;
    expect(results.id).toBe("old-q");
    expect(results.evidence.map((e) => e.id)).toContain("old-sub");

    const cols = new Set(
      (store.db().prepare("pragma table_info(questions)").all() as { name: string }[]).map((c) => c.name),
    );
    for (const col of ["payer_address", "payment_tx", "refund_tx", "closed_at", "webhook_url"]) {
      expect(cols.has(col)).toBe(true);
    }
    for (const table of ["treasury_transfers", "xrpl_escrows", "push_subscriptions"]) {
      expect(
        store.db().prepare("select name from sqlite_master where type = 'table' and name = ?").get(table),
      ).toMatchObject({ name: table });
    }

    const newObs = store.getOrCreateObserver("new-obs");
    const sub = await store.addSubmission({
      question_id: "old-q",
      observer_id: newObs.id,
      option_index: 1,
      image: { bytes: new Uint8Array([0xff, 0xd8, 9, 9, 9]), type: "image/jpeg" },
      lat: 37.8716,
      lng: -122.2536,
      accuracy_m: 5,
      distance_m: 0,
      captured_at: new Date().toISOString(),
    });
    expect(sub).toMatchObject({ ok: true });
    await store.closeNow("old-q");
    expect((await store.getResults("old-q", "http://a-eye.test"))!.status).toBe("settled");

    // Opening the connection again is a no-op (schema is idempotent).
    expect(store.db()).toBe(store.db());
  });
});
