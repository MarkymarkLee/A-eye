import { NextResponse } from "next/server";
import { latestMarketComparisons } from "@/lib/market";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requested = Number(url.searchParams.get("limit") ?? 3);
  const limit = Number.isFinite(requested) ? requested : 3;
  return NextResponse.json(
    { markets: await latestMarketComparisons(limit) },
    { headers: { "cache-control": "no-store" } },
  );
}
