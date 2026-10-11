import { NextResponse } from "next/server";
import { currentObserver } from "@/lib/observer";
import { observerXrpl } from "@/lib/store";
import { fundTestnetAccount, isXrplConfigured } from "@/lib/xrpl";

const WINDOW_MS = 10 * 60 * 1000;
const lastFundAt = new Map<string, number>();

/** Fund the observer's saved r-address from the testnet faucet (once per 10 min). */
export async function POST() {
  const obs = await currentObserver();
  if (!isXrplConfigured()) return NextResponse.json({ error: "XRP payouts aren't switched on here." }, { status: 503 });
  if (!obs.xrpl_address) return NextResponse.json({ error: "Save an XRP Ledger address first." }, { status: 400 });
  const now = Date.now();
  const last = lastFundAt.get(obs.id) ?? 0;
  if (now - last < WINDOW_MS) {
    return NextResponse.json({ error: "Already funded recently. Try again in a few minutes." }, { status: 429 });
  }
  lastFundAt.set(obs.id, now);
  try {
    await fundTestnetAccount(obs.xrpl_address);
  } catch {
    return NextResponse.json({ error: "The testnet faucet didn't answer. Try again shortly." }, { status: 502 });
  }
  return NextResponse.json(await observerXrpl(obs.id));
}
