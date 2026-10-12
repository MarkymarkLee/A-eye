import { NextResponse } from "next/server";
import { RecordMarketTradeInput } from "@a-eye/shared";
import { getMarketQuestion, getQuestionMarketRef, recordMarketTrade } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const question = await getMarketQuestion(id);
  if (!question) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  return NextResponse.json({ trades: question.market_trades }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const marketRef = getQuestionMarketRef(id);
  if (marketRef === undefined) return NextResponse.json({ error: "Question not found" }, { status: 404 });

  const token = process.env.A_EYE_TRADE_TOKEN;
  if (token && req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (marketRef === null) {
    return NextResponse.json({ error: "Question has no market reference" }, { status: 409 });
  }

  const parsed = RecordMarketTradeInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid trade", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json({ trade: recordMarketTrade(id, parsed.data) }, { status: 201 });
}
