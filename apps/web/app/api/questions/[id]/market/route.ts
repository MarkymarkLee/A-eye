import { NextResponse } from "next/server";
import { marketComparison } from "@/lib/market";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const comparison = await marketComparison(id);
  if (!comparison) return NextResponse.json({ error: "Market comparison not found" }, { status: 404 });
  return NextResponse.json(comparison, { headers: { "cache-control": "no-store" } });
}
