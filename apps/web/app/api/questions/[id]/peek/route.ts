import { AUSD } from "@a-eye/shared";
import { NextResponse } from "next/server";
import { originOf } from "@/lib/origin";
import { peekPaywallActive, peekPriceUnits, questionPayTo } from "@/lib/payments";
import { buildResults, recordPeek, settleDue } from "@/lib/store";
import { withX402Payment } from "@/lib/x402";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await settleDue();
  const origin = originOf(req);
  const results = await buildResults(id, origin);
  if (!results) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (results.status !== "open" || !peekPaywallActive()) {
    return NextResponse.json({ ...results, paid: false, payment_tx: null }, { headers: { "cache-control": "no-store" } });
  }

  return withX402Payment(
    async (_request, ctx) => {
      if (!ctx.txHash) return NextResponse.json({ error: "Payment settlement did not return a transaction" }, { status: 502 });
      recordPeek(id, ctx.payer, Number(ctx.amountUnits) / 10 ** AUSD.decimals, ctx.txHash);
      const paidResults = await buildResults(id, origin);
      if (!paidResults) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(
        { ...paidResults, paid: true, payment_tx: ctx.txHash },
        { headers: { "cache-control": "no-store" } },
      );
    },
    {
      settle: "before",
      price: () => ({ amountUnits: peekPriceUnits() }),
      payTo: questionPayTo(),
      description: `A-eye peek: interim results for ${id}`,
    },
  )(req);
}
