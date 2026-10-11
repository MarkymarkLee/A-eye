import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const testDir = mkdtempSync(path.join(tmpdir(), "a-eye-health-"));
vi.stubEnv("A_EYE_DB_PATH", path.join(testDir, "health.db"));
vi.stubEnv("A_EYE_UPLOAD_DIR", path.join(testDir, "uploads"));
vi.stubEnv("S3_BUCKET", "");

const { healthReport } = await import("./health");
const { applyPendingRestore } = await import("./store");

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(testDir, { recursive: true, force: true });
});

describe("production health checks", () => {
  it("reports a writable local database and numeric disk details", async () => {
    const report = await healthReport();

    expect(report).toMatchObject({
      ok: true,
      service: "a-eye",
      checks: {
        db: "ok",
        storage: { mode: "local", reachable: null },
      },
    });
    expect(report.checks.disk).toEqual({
      free_mb: expect.any(Number),
      used_pct: expect.any(Number),
      low: expect.any(Boolean),
    });
  });

  it("swaps in a staged restore and preserves the previous database", () => {
    const file = path.join(testDir, "restore.db");
    writeFileSync(file, "previous database");
    writeFileSync(`${file}-wal`, "pending wal");
    writeFileSync(`${file}-shm`, "pending shm");
    writeFileSync(`${file}.restore`, "restored database");

    expect(applyPendingRestore(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("restored database");
    const previous = readdirSync(testDir).find((name) => name.startsWith("restore.db.pre-restore-"));
    expect(previous).toBeDefined();
    expect(readFileSync(path.join(testDir, previous!), "utf8")).toBe("previous database");
    expect(readFileSync(path.join(testDir, `${previous}-wal`), "utf8")).toBe("pending wal");
    expect(readdirSync(testDir)).not.toContain("restore.db-wal");
    expect(readdirSync(testDir)).not.toContain("restore.db-shm");
    expect(applyPendingRestore(file)).toBe(false);
  });

  it("keeps WAL-backed writes in the preserved rollback database", () => {
    const file = path.join(testDir, "wal.db");
    const current = new DatabaseSync(file);
    current.exec("pragma journal_mode = wal; pragma wal_autocheckpoint = 0; create table t(v text); insert into t values ('kept')");

    expect(existsSync(`${file}-wal`)).toBe(true);
    expect(statSync(`${file}-wal`).size).toBeGreaterThan(0);

    const staged = new DatabaseSync(`${file}.restore`);
    staged.exec("create table t(v text)");
    staged.close();

    expect(applyPendingRestore(file)).toBe(true);
    current.close();

    const previous = readdirSync(testDir).find((name) => name.startsWith("wal.db.pre-restore-"));
    expect(previous).toBeDefined();
    const rollback = new DatabaseSync(path.join(testDir, previous!));
    expect(rollback.prepare("select v from t").all()).toEqual([{ v: "kept" }]);
    rollback.close();

    const restored = new DatabaseSync(file);
    expect(restored.prepare("select v from t").all()).toEqual([]);
    restored.close();
  });
});
