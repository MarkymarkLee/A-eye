import { NextResponse } from "next/server";
import { questionsByAgent } from "@/lib/store";
import { originOf } from "@/lib/origin";

export const dynamic = "force-dynamic";

// TODO(milestone 3): identify the agent by its x402 payer address instead of a header.
export async function GET(req: Request) {
  const agent = req.headers.get("x-a-eye-agent");
  if (!agent) return NextResponse.json({ error: "Missing x-a-eye-agent header" }, { status: 400 });
  return NextResponse.json({ questions: await questionsByAgent(agent, originOf(req)) });
}
