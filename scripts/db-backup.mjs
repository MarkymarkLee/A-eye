import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const dbFile = process.env.A_EYE_DB_PATH ?? path.join(process.cwd(), "apps", "web", ".data", "a-eye.db");
const bucket = process.env.S3_BUCKET;
const s3 = bucket
  ? new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    })
  : undefined;

function backupName() {
  return `a-eye-${new Date().toISOString().replaceAll(":", "-")}.db`;
}

function sqlPath(file) {
  return `'${file.replaceAll("'", "''")}'`;
}

async function backup() {
  const name = backupName();
  const snapshot = path.join(os.tmpdir(), name);
  const database = new DatabaseSync(dbFile);
  try {
    database.exec("pragma busy_timeout = 5000");
    database.exec(`vacuum into ${sqlPath(snapshot)}`);
  } finally {
    database.close();
  }

  try {
    const { size } = await stat(snapshot);
    if (s3 && bucket) {
      const key = `backups/${name}`;
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: await readFile(snapshot),
        ContentType: "application/vnd.sqlite3",
      }));
      console.log(`${key} ${size}`);
    } else {
      const directory = path.join(path.dirname(dbFile), "backups");
      const destination = path.join(directory, name);
      await mkdir(directory, { recursive: true });
      await copyFile(snapshot, destination);
      console.log(`${destination} ${size}`);
    }
  } finally {
    await rm(snapshot, { force: true });
  }
}

async function list() {
  if (!s3 || !bucket) {
    throw new Error("S3_BUCKET is required to list remote backups.");
  }
  const objects = [];
  let ContinuationToken;
  try {
    do {
      const page = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "backups/",
        ContinuationToken,
      }));
      objects.push(...(page.Contents ?? []));
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
  } catch {
    throw new Error("Unable to list S3 backups. Confirm the bucket and that the configured credentials allow ListBucket.");
  }
  objects.sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));
  for (const object of objects) {
    console.log(`${object.Key}\t${object.Size ?? 0}\t${object.LastModified?.toISOString() ?? ""}`);
  }
}

async function restore(source) {
  if (!source) throw new Error("Usage: npm run db:restore -- <S3 key or local path>");
  const staged = `${dbFile}.restore`;
  await mkdir(path.dirname(dbFile), { recursive: true });
  try {
    if (existsSync(source)) {
      await copyFile(source, staged);
    } else {
      if (!s3 || !bucket) throw new Error(`Local backup not found and S3_BUCKET is unset: ${source}`);
      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: source }));
      if (!response.Body) throw new Error(`S3 object has no body: ${source}`);
      await writeFile(staged, await response.Body.transformToByteArray());
    }

    const database = new DatabaseSync(staged);
    let result;
    try {
      result = Object.values(database.prepare("pragma integrity_check").get() ?? {})[0];
    } finally {
      database.close();
    }
    if (result !== "ok") throw new Error("Backup failed SQLite integrity_check.");
  } catch (error) {
    await rm(staged, { force: true });
    throw error;
  }
  console.log("Staged. Restart the service to apply (db() swaps it in at boot).");
}

try {
  const command = process.argv[2];
  if (command === "backup") await backup();
  else if (command === "list") await list();
  else if (command === "restore") await restore(process.argv[3]);
  else throw new Error("Usage: node scripts/db-backup.mjs <backup|list|restore>");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database backup operation failed.");
  process.exitCode = 1;
}
