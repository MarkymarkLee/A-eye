import { NextResponse } from "next/server";
import { z } from "zod";
import { currentObserver } from "@/lib/observer";
import { pushConfig } from "@/lib/push";
import { deletePushSubscription, savePushSubscription } from "@/lib/store";
import { isCrossSiteRequest } from "@/lib/same-origin";
import { readBodyText } from "@/lib/body";
import { isAllowedPushEndpoint } from "@/lib/push-targets";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit";

const PostBody = z.object({
  subscription: z.object({
    endpoint: z.url().refine(isAllowedPushEndpoint, "Unsupported push endpoint."),
    keys: z.object({
      p256dh: z.string().min(1).max(200),
      auth: z.string().min(1).max(100),
    }),
  }),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

const DeleteBody = z.object({ endpoint: z.url().startsWith("https://") });

export async function POST(req: Request) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }
  const limit = rateLimit(`push-subscription:${clientIp(req)}`, 20, 10 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterS);
  const text = await readBodyText(req, 4 * 1024);
  if (text === null) return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  if (!pushConfig()) {
    return NextResponse.json({ error: "Push notifications are not configured" }, { status: 503 });
  }
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subscription", issues: parsed.error.issues }, { status: 400 });
  }
  const observer = await currentObserver();
  const { subscription, lat, lng } = parsed.data;
  savePushSubscription({
    observerId: observer.id,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    lat,
    lng,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }
  const text = await readBodyText(req, 4 * 1024);
  if (text === null) return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const parsed = DeleteBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid endpoint", issues: parsed.error.issues }, { status: 400 });
  }
  deletePushSubscription(parsed.data.endpoint);
  return NextResponse.json({ ok: true });
}
