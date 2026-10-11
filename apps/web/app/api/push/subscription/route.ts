import { NextResponse } from "next/server";
import { z } from "zod";
import { currentObserver } from "@/lib/observer";
import { pushConfig } from "@/lib/push";
import { deletePushSubscription, savePushSubscription } from "@/lib/store";

const PostBody = z.object({
  subscription: z.object({
    endpoint: z.url().startsWith("https://"),
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
  if (!pushConfig()) {
    return NextResponse.json({ error: "Push notifications are not configured" }, { status: 503 });
  }
  const parsed = PostBody.safeParse(await req.json().catch(() => null));
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
  const parsed = DeleteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid endpoint", issues: parsed.error.issues }, { status: 400 });
  }
  deletePushSubscription(parsed.data.endpoint);
  return NextResponse.json({ ok: true });
}
