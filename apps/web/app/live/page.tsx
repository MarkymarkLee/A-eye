import type { Metadata } from "next";
import QRCode from "qrcode";
import { activity } from "@/lib/activity";
import { requestOrigin } from "@/lib/request-origin";
import { latestMarketComparisons } from "@/lib/market";
import { LiveDashboard } from "@/components/live-dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Live", description: "Every question, photo, raffle and payout on A-eye as it happens." };

export default async function LivePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const origin = await requestOrigin();
  const target = q && /^[\w-]{1,40}$/.test(q) ? `${origin}/q/${q}/answer` : `${origin}/`;
  const qr = await QRCode.toString(target, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#111316", light: "#ffffff" } });
  const initial = await activity({ origin, limit: 80 });
  const initialMarkets = await latestMarketComparisons(3);
  return <LiveDashboard initial={initial} initialMarkets={initialMarkets} qrSvg={qr} target={target} />;
}
