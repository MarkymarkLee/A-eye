import { NextResponse } from "next/server";
import { questionsByAgent } from "@/lib/store";
import { originOf } from "@/lib/origin";

export const dynamic = "force-dynamic";

// Paid questions use x-a-eye-agent when provided, otherwise their x402 payer address.
export async function GET(req: Request) {
  const agent = req.headers.get("x-a-eye-agent")?.trim();
  if (!agent) return NextResponse.json({ error: "Missing x-a-eye-agent header" }, { status: 400 });
  return NextResponse.json({ questions: await questionsByAgent(agent, originOf(req)) });
}
