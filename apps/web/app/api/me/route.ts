import { NextResponse } from "next/server";
import { z } from "zod";
import { currentObserver } from "@/lib/observer";
import { observerEntries, updateObserver } from "@/lib/store";

const Patch = z.object({
  display_name: z.string().trim().min(2).max(40).optional(),
  evm_address: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Use a 0x address with 40 hex characters.")
    .optional()
    .or(z.literal("")),
});

export async function GET() {
  const obs = await currentObserver();
  return NextResponse.json({ observer: obs, entries: observerEntries(obs.id) });
}

export async function PUT(req: Request) {
  const obs = await currentObserver();
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" }, { status: 400 });
  }
  const { evm_address, ...rest } = parsed.data;
  const updated = updateObserver(obs.id, { ...rest, evm_address: evm_address === "" ? null : evm_address });
  return NextResponse.json({ observer: updated });
}
