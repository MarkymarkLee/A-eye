export function originOf(req: Request) {
  const trustedOrigin = process.env.A_EYE_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (trustedOrigin) return trustedOrigin.replace(/\/+$/, "");
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}
