import { createHash } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "local";
}

export function resolveAgent(req: Request): string {
  const label = req.headers.get("x-a-eye-agent")?.trim();
  if (label) return label.slice(0, 64);

  const authorization = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  const key = bearer || new URL(req.url).searchParams.get("key")?.trim();
  if (key) return `key:${digest(key).slice(0, 24)}`;

  return `anon:${digest(clientIp(req)).slice(0, 16)}`;
}
