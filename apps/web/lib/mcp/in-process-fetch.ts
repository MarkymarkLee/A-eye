import type { FetchLike } from "@a-eye/mcp/api";
import { GET as getCoverage } from "@/app/api/coverage/route";
import { GET as getImage } from "@/app/api/images/[...key]/route";
import { GET as getQuestion } from "@/app/api/questions/[id]/route";
import { GET as getMine } from "@/app/api/questions/mine/route";
import { GET as getQuestions, POST as postQuestion } from "@/app/api/questions/route";

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

export function createInProcessFetch(publicOrigin: string, incoming: Headers): FetchLike {
  const expectedOrigin = new URL(publicOrigin).origin;

  return async (input, init) => {
    const url = new URL(input, expectedOrigin);
    if (url.origin !== expectedOrigin) return globalThis.fetch(input, init);

    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(incoming);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const body = method === "GET" || method === "HEAD" ? undefined : init?.body;
    const req = new Request(url, { ...init, method, headers, body });

    if (method === "POST" && url.pathname === "/api/questions") return postQuestion(req);
    if (method === "GET" && url.pathname === "/api/questions/mine") return getMine(req);
    if (method === "GET" && url.pathname === "/api/questions") return getQuestions(req);
    if (method === "GET" && url.pathname === "/api/coverage") return getCoverage(req);

    if (method === "GET" && url.pathname.startsWith("/api/images/")) {
      const key = url.pathname.slice("/api/images/".length);
      if (!key) return notFound();
      return getImage(req, { params: Promise.resolve({ key: key.split("/").map(decodeURIComponent) }) });
    }

    const match = /^\/api\/questions\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && match) {
      return getQuestion(req, { params: Promise.resolve({ id: decodeURIComponent(match[1]!) }) });
    }

    return notFound();
  };
}
