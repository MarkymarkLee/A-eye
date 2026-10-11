export function isCrossSiteRequest(req: Request): boolean {
  const headers = req.headers;
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite !== "same-origin" && fetchSite !== "none";

  const origin = headers.get("origin");
  if (origin !== null) {
    if (origin === "null") return true;
    const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]!.trim();
    try {
      return new URL(origin).host !== host;
    } catch {
      return true;
    }
  }
  return false;
}
