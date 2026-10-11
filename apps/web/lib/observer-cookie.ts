import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_VALUE = /^([A-Za-z0-9-]{1,64})\.([A-Za-z0-9_-]+)$/;
const LEGACY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function signObserverId(id: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(id).digest("base64url");
  return `${id}.${signature}`;
}

export function verifyObserverCookie(value: string | undefined, secret: string): string | undefined {
  if (!value) return undefined;
  const match = COOKIE_VALUE.exec(value);
  if (!match) return undefined;
  const [, id, signature] = match;
  const expected = Buffer.from(signObserverId(id!, secret).split(".")[1]!, "base64url");
  const received = Buffer.from(signature!, "base64url");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined;
  return id;
}

export function isLegacyObserverId(value: string | undefined): boolean {
  return value !== undefined && LEGACY_UUID.test(value);
}
