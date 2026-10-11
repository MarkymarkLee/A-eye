import { NextResponse } from "next/server";
import { CreateQuestionInput } from "@a-eye/shared";
import { startEnrichment } from "@/lib/enrich";
import { startNearbyPush } from "@/lib/push";
import { allOpenQuestions, createQuestion, escrowQuestionPot, getResults, nearbyQuestions } from "@/lib/store";
import { originOf } from "@/lib/origin";
import { paymentsEnabled, prizeUnits, questionPayTo, sendFromTreasury } from "@/lib/payments";
import { withX402Payment } from "@/lib/x402";
import { readBodyText } from "@/lib/body";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hasLat = url.searchParams.has("lat");
  const hasLng = url.searchParams.has("lng");
  const hasMaxKm = url.searchParams.has("max_km");
  const latValue = url.searchParams.get("lat");
  const lngValue = url.searchParams.get("lng");
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const requestedMaxKm = Number(url.searchParams.get("max_km"));
  if (
    hasLat &&
    (!hasLng ||
      !latValue?.trim() ||
      !lngValue?.trim() ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lng) ||
      lng < -180 ||
      lng > 180)
  ) {
    return NextResponse.json({ error: "lat and lng must both be valid coordinates" }, { status: 400 });
  }
  if (hasMaxKm && (!Number.isFinite(requestedMaxKm) || requestedMaxKm <= 0)) {
    return NextResponse.json({ error: "max_km must be a positive number" }, { status: 400 });
  }
  if (hasLat) {
    return NextResponse.json({ questions: await nearbyQuestions(lat, lng, Math.min(hasMaxKm ? requestedMaxKm : 5, 50)) });
  }
  return NextResponse.json({ questions: await allOpenQuestions() });
}

// Built per request so A_EYE_TREASURY_ADDRESS / key changes apply without a module reload.
const createPaidQuestion = (payTo: string) =>
  withX402Payment<unknown>(
    async (req, payment) => {
      const parsed = CreateQuestionInput.parse(await req.json());
      const id = createQuestion(parsed, payment.payer, { payer: payment.payer, tx: payment.txHash }, originOf(req));
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
  const text = await readBodyText(req, 32 * 1024);
  if (text === null) return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  const rebuilt = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: text || undefined,
  });
  // Dev bypass: ALLOW_UNPAID_QUESTIONS=1 skips x402 (also the default outside production when no treasury is set).
  const unpaidAllowed =
    process.env.ALLOW_UNPAID_QUESTIONS === "1" || (process.env.NODE_ENV !== "production" && !paymentsEnabled());
  if (!unpaidAllowed) {
    const payTo = questionPayTo();
    if (!payTo) {
      return NextResponse.json(
        { error: "Payments are not configured", message: "x402 payments are not configured on this server" },
        { status: 503 },
      );
    }
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const parsed = CreateQuestionInput.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid question", issues: parsed.error.issues }, { status: 400 });
    }
    return createPaidQuestion(payTo)(rebuilt);
  }
  const limit = rateLimit(`questions:${clientIp(rebuilt)}`, 20, 10 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterS);
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const parsed = CreateQuestionInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid question", issues: parsed.error.issues }, { status: 400 });
  }
  const id = createQuestion(parsed.data, rebuilt.headers.get("x-a-eye-agent")?.slice(0, 64) || undefined, undefined, originOf(rebuilt));
  return created(rebuilt, id, null, parsed.data);
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
