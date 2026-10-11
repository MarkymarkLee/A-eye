import { NextResponse } from "next/server";
import { closeNow } from "@/lib/store";

/** Dev-only: force a question to close so the raffle can be demoed on demand. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const closed = await closeNow(id);
  return NextResponse.json({ closed }, { status: closed ? 200 : 409 });
}
