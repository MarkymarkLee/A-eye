import { z } from "zod";
import { NextResponse } from "next/server";
import { activity } from "@/lib/activity";
import { originOf } from "@/lib/origin";

export const dynamic = "force-dynamic";

const isoDateTime = z.string().datetime({ offset: true });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawSince = url.searchParams.get("since");
  const since = rawSince === null || rawSince === "" ? undefined : rawSince;
  if (since && !isoDateTime.safeParse(since).success) {
    return NextResponse.json({ error: "Invalid since value; expected an ISO datetime." }, { status: 400 });
  }

  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? undefined : Number(rawLimit);
  if (limit !== undefined && !Number.isFinite(limit)) {
    return NextResponse.json({ error: "Invalid limit value." }, { status: 400 });
  }

  return NextResponse.json(await activity({ origin: originOf(req), since, limit }), {
    headers: { "cache-control": "no-store" },
  });
}
