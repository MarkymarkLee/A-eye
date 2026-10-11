import { NextResponse } from "next/server";
import { pushConfig } from "@/lib/push";
import { PUSH_RADIUS_M } from "@/lib/push-targets";

export function GET() {
  const cfg = pushConfig();
  return NextResponse.json({ enabled: cfg !== null, public_key: cfg?.publicKey ?? null, radius_m: PUSH_RADIUS_M });
}
