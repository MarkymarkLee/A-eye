import { NextResponse } from "next/server";
import { z } from "zod";
import { PayoutRail } from "@a-eye/shared";
import { currentObserver } from "@/lib/observer";
import { maybeIssueObserverCredential, observerCredential, observerEntries, observerStats, updateObserver } from "@/lib/store";
import { isClassicAddress } from "@/lib/xrpl";

const Patch = z
  .object({
    display_name: z.string().trim().min(2).max(40).optional(),
    evm_address: z
      .string()
      .trim()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Use a 0x address with 40 hex characters.")
      .optional()
      .or(z.literal("")),
    xrpl_address: z
      .string()
      .trim()
      .refine(isClassicAddress, "Use a classic XRPL address starting with r.")
      .optional()
      .or(z.literal("")),
    payout_rail: PayoutRail.optional(),
  });

export async function GET() {
  const obs = await currentObserver();
  return NextResponse.json({
    observer: obs,
    entries: observerEntries(obs.id),
    stats: await observerStats(obs.id),
    xrpl: observerCredential(obs.id),
  });
}

export async function PUT(req: Request) {
  const obs = await currentObserver();
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" }, { status: 400 });
  }
  const { evm_address, xrpl_address, ...rest } = parsed.data;
  const nextXrpl = xrpl_address === undefined ? obs.xrpl_address : xrpl_address || undefined;
  if ((rest.payout_rail ?? obs.payout_rail) === "xrpl" && !nextXrpl) {
    return NextResponse.json({ error: "Add an XRPL address to get paid on XRPL." }, { status: 400 });
  }
  const updated = updateObserver(obs.id, {
    ...rest,
    evm_address: evm_address === "" ? null : evm_address,
    xrpl_address: xrpl_address === "" ? null : xrpl_address,
  });
  await maybeIssueObserverCredential(obs.id);
  return NextResponse.json({ observer: updated, xrpl: observerCredential(obs.id) });
}
