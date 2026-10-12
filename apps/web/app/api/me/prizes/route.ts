import { NextResponse } from "next/server";
import { peekObserverId } from "@/lib/observer";
import { getObserver, observerPrizes, passkeysFor } from "@/lib/store";

export async function GET() {
  const observerId = await peekObserverId();
  if (!observerId || !getObserver(observerId)) return NextResponse.json({ prizes: [], has_passkey: false });
  return NextResponse.json({
    prizes: observerPrizes(observerId),
    has_passkey: passkeysFor(observerId).length > 0,
  });
}
