import "server-only";
import { headers } from "next/headers";

export async function requestOrigin() {
  const trustedOrigin = process.env.A_EYE_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (trustedOrigin) return trustedOrigin.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
