import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/*
 * Photo storage. With S3_BUCKET set, photos go to S3 (or any S3-compatible
 * endpoint such as MinIO via S3_ENDPOINT) and are served as presigned URLs,
 * so the bucket stays private. Without it, photos land in .data/uploads and
 * are served through /api/images/[key].
 */

const bucket = process.env.S3_BUCKET;
const localDir = process.env.A_EYE_UPLOAD_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "uploads");

const s3 = bucket
  ? new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    })
  : undefined;

export const storageMode = s3 ? "s3" : "local";

let reachabilityCache: { checkedAt: number; reachable: boolean } | undefined;

export async function storageReachable(): Promise<boolean | null> {
  if (!s3 || !bucket) return null;
  if (reachabilityCache && Date.now() - reachabilityCache.checkedAt < 60_000) {
    return reachabilityCache.reachable;
  }
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(3000) });
    reachabilityCache = { checkedAt: Date.now(), reachable: true };
  } catch {
    reachabilityCache = { checkedAt: Date.now(), reachable: false };
  }
  return reachabilityCache.reachable;
}

const safeKey = (key: string) => /^[a-z0-9/_-]+\.jpg$/i.test(key) && !key.includes("..");

export async function putImage(key: string, bytes: Uint8Array, contentType: string) {
  if (s3) {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
    return;
  }
  const file = path.join(/* turbopackIgnore: true */ localDir, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

/** URL an agent or browser can load directly. Presigned for an hour on S3. */
export async function imageUrl(key: string, origin: string) {
  if (s3) {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
  }
  return `${origin}/api/images/${key}`;
}

/** Local-mode reader for /api/images. */
export async function readLocalImage(key: string) {
  if (s3 || !safeKey(key)) return undefined;
  try {
    return await readFile(path.join(/* turbopackIgnore: true */ localDir, key));
  } catch {
    return undefined;
  }
}
