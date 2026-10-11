import { promises as dns } from "node:dns";
import { isIP } from "node:net";

type LookupAddress = { address: string; family: number };
type LookupAll = (hostname: string, options: { all: true }) => Promise<LookupAddress[]>;

function parseIpv4(ip: string): number[] | undefined {
  if (isIP(ip) !== 4) return undefined;
  return ip.split(".").map(Number);
}

function isPublicIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) return false;
  const [a, b, c] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a! >= 224
  );
}

function ipv6Words(ip: string): number[] | undefined {
  const address = ip.split("%")[0]!.toLowerCase();
  const embedded = address.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  let normalized = address;
  let mappedWords: number[] | undefined;
  if (embedded) {
    const bytes = parseIpv4(embedded[1]!);
    if (!bytes) return undefined;
    mappedWords = [((bytes[0]! << 8) | bytes[1]!), ((bytes[2]! << 8) | bytes[3]!)];
    normalized = address.slice(0, -embedded[1]!.length) + `${mappedWords[0]!.toString(16)}:${mappedWords[1]!.toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0]!.split(":").filter(Boolean).map((word) => Number.parseInt(word, 16)) : [];
  const right = halves.length === 2 && halves[1] ? halves[1]!.split(":").filter(Boolean).map((word) => Number.parseInt(word, 16)) : [];
  if ([...left, ...right].some((word) => !Number.isFinite(word) || word < 0 || word > 0xffff)) return undefined;
  if (halves.length === 1) return left.length === 8 ? left : undefined;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return undefined;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicIpv4(ip);
  if (family !== 6) return false;

  const words = ipv6Words(ip);
  if (!words) return false;
  if (words.every((word) => word === 0)) return false;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return false;
  if ((words[0]! & 0xfe00) === 0xfc00) return false;
  if ((words[0]! & 0xffc0) === 0xfe80) return false;
  if ((words[0]! & 0xff00) === 0xff00) return false;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const embeddedIpv4 = [
      words[6]! >> 8,
      words[6]! & 0xff,
      words[7]! >> 8,
      words[7]! & 0xff,
    ].join(".");
    return isPublicIpv4(embeddedIpv4);
  }
  return true;
}

export async function assertPublicUrl(url: string, lookup: LookupAll = (host, options) => dns.lookup(host, options)) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("only http(s) URLs are allowed");
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (hostname.toLowerCase() === "localhost" || hostname.toLowerCase().endsWith(".localhost")) {
    throw new Error("localhost URLs are not allowed");
  }
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error("URL address is not public");
    return;
  }
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("URL hostname does not resolve only to public addresses");
  }
}

export type WebhookFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function postWebhook(
  url: string,
  payload: unknown,
  opts: {
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
    fetchImpl?: WebhookFetch;
    lookup?: LookupAll;
  } = {},
): Promise<{ ok: boolean; status?: number; error?: string; attempts: number }> {
  const { timeoutMs = 5000, retries = 1, retryDelayMs = 1000, fetchImpl = fetch, lookup } = opts;
  try {
    await assertPublicUrl(url, lookup);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), attempts: 0 };
  }

  const maxAttempts = Math.max(1, 1 + Math.floor(retries));
  let status: number | undefined;
  let error: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "A-eye-webhook/1",
          "x-a-eye-event": "question.closed",
        },
        body: JSON.stringify(payload),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      if (response.status >= 200 && response.status < 300) return { ok: true, status, attempts: attempt };
      error = `HTTP ${response.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return { ok: false, status, error, attempts: maxAttempts };
}
