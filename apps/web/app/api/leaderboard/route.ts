import { NextResponse } from "next/server";
import { z } from "zod";
import { peekObserverId } from "@/lib/observer";
import { leaderboard } from "@/lib/store";

export const dynamic = "force-dynamic";

const Range = z.enum(["week", "all"]);

export async function GET(req: Request) {
  const parsed = Range.safeParse(new URL(req.url).searchParams.get("range") ?? "week");
  if (!parsed.success) {
    return NextResponse.json({ error: "range must be week or all" }, { status: 400 });
  }
  const entries = await leaderboard(parsed.data, await peekObserverId());
  return NextResponse.json({ range: parsed.data, entries });
}
