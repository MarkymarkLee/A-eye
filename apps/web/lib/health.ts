import "server-only";
import { statfs } from "node:fs/promises";
import path from "node:path";
import { AUSD, X402_NETWORK } from "@a-eye/shared";
import { dbWritable } from "./store";
import { storageMode, storageReachable } from "./storage";

export async function healthReport() {
  const db = dbWritable() ? "ok" : "error";
  const dbFile = process.env.A_EYE_DB_PATH ?? path.join(process.cwd(), ".data", "a-eye.db");
  let disk: { free_mb: number; used_pct: number; low: boolean } | null = null;
  try {
    const { bavail, blocks, bsize } = await statfs(path.dirname(dbFile));
    const free_mb = (bavail * bsize) / (1024 * 1024);
    const used_pct = blocks > 0 ? (1 - bavail / blocks) * 100 : 0;
    disk = { free_mb, used_pct, low: free_mb < 50 || used_pct > 90 };
  } catch {
    disk = null;
  }

  return {
    ok: db === "ok",
    service: "a-eye" as const,
    network: X402_NETWORK,
    asset: AUSD.address,
    commit: process.env.RENDER_GIT_COMMIT ?? null,
    checks: {
      db,
      disk,
      storage: { mode: storageMode, reachable: await storageReachable() },
    },
  };
}
