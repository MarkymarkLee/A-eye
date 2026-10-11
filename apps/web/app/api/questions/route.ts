import { NextResponse } from "next/server";
import { CreateQuestionInput } from "@a-eye/shared";
import { startEnrichment } from "@/lib/enrich";
import { startNearbyPush } from "@/lib/push";
import { allOpenQuestions, createQuestion, escrowQuestionPot, getResults, nearbyQuestions } from "@/lib/store";
import { originOf } from "@/lib/origin";
import { paymentsEnabled, prizeUnits, questionPayTo, sendFromTreasury } from "@/lib/payments";
import { withX402Payment } from "@/lib/x402";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const maxKm = Number(url.searchParams.get("max_km") ?? 5);
  if (url.searchParams.has("lat") && Number.isFinite(lat) && Number.isFinite(lng)) {
    return NextResponse.json({ questions: await nearbyQuestions(lat, lng, maxKm) });
  }
  return NextResponse.json({ questions: await allOpenQuestions() });
}

// Built per request so A_EYE_TREASURY_ADDRESS / key changes apply without a module reload.
const createPaidQuestion = (payTo: string) =>
  withX402Payment<unknown>(
    async (req, payment) => {
      const parsed = CreateQuestionInput.parse(await req.json());
      const agent = req.headers.get("x-a-eye-agent")?.trim().slice(0, 64) || payment.payer;
      const id = createQuestion(parsed, agent, { payer: payment.payer, tx: payment.txHash }, originOf(req));
      return created(req, id, payment.txHash, parsed);
    },
    {
      price: (_req, body) => {
        const parsed = CreateQuestionInput.safeParse(body);
        if (!parsed.success) throw new Error(`Invalid question: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
        return { amountUnits: prizeUnits(parsed.data.prize_usd) };
      },
      payTo,
      description: "A-eye question bounty (raffle prize for nearby observers)",
      // Payment settles before the question is created; refund if creation fails after that.
      onHandlerFailure: async (ctx) => {
        await sendFromTreasury("refund", ctx.payer, ctx.amountUnits);
      },
    },
  );

export async function POST(req: Request) {
  // Dev bypass: ALLOW_UNPAID_QUESTIONS=1 skips x402 (also the default outside production when no treasury is set).
  const unpaidAllowed =
    process.env.ALLOW_UNPAID_QUESTIONS === "1" || (process.env.NODE_ENV !== "production" && !paymentsEnabled());
  if (!unpaidAllowed) {
    const payTo = questionPayTo();
    if (!payTo) {
      return NextResponse.json({ error: "Payment required", message: "x402 payments are not configured" }, { status: 402 });
    }
    return createPaidQuestion(payTo)(req);
  }
  const parsed = CreateQuestionInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid question", issues: parsed.error.issues }, { status: 400 });
  }
  const id = createQuestion(parsed.data, req.headers.get("x-a-eye-agent")?.slice(0, 64) || undefined, undefined, originOf(req));
  return created(req, id, null, parsed.data);
}

async function created(req: Request, id: string, paymentTx: string | null, input: Parameters<typeof createQuestion>[0]) {
  startEnrichment(id, input);
  const xrplEscrowTx = input.xrpl_escrow ? await escrowQuestionPot(id) : undefined;
  startNearbyPush(id, input);
  const results = await getResults(id, originOf(req));
  return NextResponse.json(
    {
      question_id: id,
      gallery_url: results!.gallery_url,
      seed_commit: results!.raffle.seed_commit,
      payment_tx: paymentTx,
      ...(xrplEscrowTx !== undefined && { xrpl_escrow_tx: xrplEscrowTx }),
    },
    { status: 201 },
  );
}
