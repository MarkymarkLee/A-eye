import { NextResponse } from "next/server";
import { getResults } from "@/lib/store";
import { originOf } from "@/lib/origin";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const results = await getResults(id, originOf(req));
  if (!results) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(results, { headers: { "cache-control": "no-store" } });
}
