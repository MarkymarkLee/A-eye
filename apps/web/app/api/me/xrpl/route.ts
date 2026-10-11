import { NextResponse } from "next/server";
import { currentObserver } from "@/lib/observer";
import { observerXrpl, syncObserverReputation } from "@/lib/store";

/** Live XRPL testnet status for the signed-in observer (no seeds ever cross this API). */
export async function GET() {
  const obs = await currentObserver();
  try {
    await syncObserverReputation([obs.id]);
  } catch (err) {
    console.error("[xrpl] reputation sync failed:", err instanceof Error ? err.message : err);
  }
  return NextResponse.json(await observerXrpl(obs.id));
}
