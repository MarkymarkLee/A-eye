import { NextResponse } from "next/server";
import { CreateQuestionInput } from "@a-eye/shared";
import { allOpenQuestions, createQuestion, getResults, nearbyQuestions } from "@/lib/store";
import { originOf } from "@/lib/origin";

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

export async function POST(req: Request) {
  // TODO(milestone 3): x402 middleware charges prize_usd in AUSD before this runs.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_UNPAID_QUESTIONS !== "1") {
    return NextResponse.json({ error: "Payment required" }, { status: 402 });
  }
  const parsed = CreateQuestionInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid question", issues: parsed.error.issues }, { status: 400 });
  }
  const id = createQuestion(parsed.data);
  const results = await getResults(id, originOf(req));
  return NextResponse.json(
    { question_id: id, gallery_url: results!.gallery_url, seed_commit: results!.raffle.seed_commit, payment_tx: null },
    { status: 201 },
  );
}
