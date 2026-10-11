"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, Check, Coins, Copy, ExternalLink, Sparkles, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Disclosure } from "./ui/disclosure";
import { Skeleton } from "./ui/skeleton";

import type { SubmittableTransaction } from "xrpl";

const SEED_KEY = "aeye.xrpl.testnet.seed";
const TESTNET_WSS = "wss://s.altnet.rippletest.net:51233";
const RLUSD_LIMIT = "1000000";

type Status = {
  enabled: boolean;
  network: "testnet";
  address?: string;
  issuer?: string;
  accepted: number;
  threshold: number;
  funded: boolean;
  xrp_balance?: string;
  rlusd: { trustline: boolean; balance?: string };
  reputation: {
    issuance_id?: string;
    opted_in: boolean;
    balance?: string;
    earned: number;
    minted: number;
    explorer_url?: string;
  };
  credential?: { subject: string; state: "pending" | "issued" | "failed"; tx?: string; url?: string };
};

const truncate = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function savedSeedFor(address?: string): string | null {
  try {
    const raw = localStorage.getItem(SEED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { address?: string; seed?: string };
    return parsed.address === address && parsed.seed ? parsed.seed : null;
  } catch {
    return null;
  }
}

function saveSeed(address: string, seed: string) {
  localStorage.setItem(SEED_KEY, JSON.stringify({ address, seed }));
}

async function signAndSubmit(tx: SubmittableTransaction, seed: string) {
  const { Client, Wallet } = await import("xrpl");
  const wallet = Wallet.fromSeed(seed);
  const client = new Client(TESTNET_WSS);
  try {
    await client.connect();
    return await client.submitAndWait(tx, { autofill: true, wallet });
  } finally {
    if (client.isConnected()) await client.disconnect();
  }
}

/** Numbered checklist that onboards an observer onto the XRPL testnet rail. */
export function XrplWalletSetup({ badge }: { badge: React.ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [hasSeed, setHasSeed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/me/xrpl", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const next = (await res.json()) as Status;
      setStatus(next);
      setHasSeed(Boolean(savedSeedFor(next.address)));
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createWallet() {
    setBusy("wallet");
    try {
      const { Wallet } = await import("xrpl");
      const wallet = Wallet.generate();
      if (!wallet.seed) throw new Error();
      const put = await fetch("/api/me", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ xrpl_address: wallet.address, payout_rail: "xrpl" }),
      });
      if (!put.ok) throw new Error((await put.json().catch(() => null))?.error ?? "save_failed");
      saveSeed(wallet.address, wallet.seed);
      const fund = await fetch("/api/me/xrpl/fund", { method: "POST" });
      if (!fund.ok) toast.message("Wallet created", { description: "Test coins are on their way; it can take a minute to show up." });
      haptic("success");
      toast.success("Test wallet ready", { description: wallet.address });
      await refresh();
    } catch (err) {
      haptic("error");
      toast.error("Couldn't create the wallet", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function onboard() {
    const seed = savedSeedFor(status?.address);
    if (!seed || !status?.address) return;
    setBusy("onboard");
    try {
      const { buildObserverOnboardingBatch } = await import("@/lib/xrpl");
      const tx = buildObserverOnboardingBatch(status.address, status.reputation.issuance_id);
      const res = await signAndSubmit(tx, seed);
      const meta = res.result.meta as { TransactionResult?: string } | undefined;
      if (meta?.TransactionResult !== "tesSUCCESS") throw new Error(meta?.TransactionResult ?? "failed");
      haptic("success");
      toast.success("All set", { description: "You can now receive digital dollars and reputation points." });
      await refresh();
    } catch (err) {
      haptic("error");
      toast.error("That didn't go through", { description: err instanceof Error ? err.message : "Try again in a moment." });
    } finally {
      setBusy(null);
    }
  }

  async function acceptBadge() {
    const seed = savedSeedFor(status?.address);
    if (!seed || !status?.address || !status.issuer) return;
    setBusy("badge");
    try {
      const { buildCredentialAccept } = await import("@/lib/xrpl");
      const res = await signAndSubmit(buildCredentialAccept(status.address, status.issuer), seed);
      const meta = res.result.meta as { TransactionResult?: string } | undefined;
      if (meta?.TransactionResult !== "tesSUCCESS" && meta?.TransactionResult !== "tecDUPLICATE") {
        throw new Error(meta?.TransactionResult ?? "failed");
      }
      haptic("success");
      toast.success("Badge accepted");
      await refresh();
    } catch (err) {
      haptic("error");
      toast.error("Couldn't accept the badge", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  if (loadFailed) return null;
  if (!status) {
    return (
      <Card className="mt-4 grid gap-3 p-5" aria-busy>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 rounded-[14px]" />
        <Skeleton className="h-10 rounded-[14px]" />
      </Card>
    );
  }
  if (!status.enabled) return null;

  const trustSetJson = JSON.stringify(
    {
      TransactionType: "TrustSet",
      Account: status.address ?? "r…",
      LimitAmount: {
        currency: "524C555344000000000000000000000000000000",
        issuer: "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
        value: RLUSD_LIMIT,
      },
    },
    null,
    2,
  );

  const stepsDone: [boolean, boolean, boolean] = [
    Boolean(status.address),
    status.rlusd.trustline,
    status.reputation.opted_in,
  ];

  return (
    <Card className="mt-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold tracking-tight">XRP Ledger payouts</h2>
        <Badge tone={stepsDone.every(Boolean) ? "accent" : "sky"}>
          {stepsDone.filter(Boolean).length} of {stepsDone.length} set up
        </Badge>
      </div>
      <p className="mt-1 text-[13.5px] text-muted">
        Test network only. Winnings arrive as RLUSD digital dollars on the XRP Ledger.
      </p>

      <ol className="mt-4 grid gap-3">
        <Step
          n={1}
          done={stepsDone[0]}
          title="Your XRP Ledger wallet"
          body={
            status.address ? (
              <>
                <span className="font-mono text-[13px]">{truncate(status.address)}</span>{" "}
                <a
                  href={`https://testnet.xrpl.org/accounts/${status.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 underline decoration-line underline-offset-4 hover:decoration-ink"
                >
                  View <ExternalLink className="size-3" aria-hidden />
                </a>
                {status.xrp_balance && <span className="block text-[12.5px] text-muted">{status.xrp_balance} XRP</span>}
              </>
            ) : (
              "Test network only. Your key stays in this browser."
            )
          }
          action={
            !status.address && (
              <Button size="sm" onClick={createWallet} disabled={busy !== null}>
                <Wallet className="size-4" aria-hidden /> {busy === "wallet" ? "Creating…" : "Create a test wallet on this phone"}
              </Button>
            )
          }
        />
        <Step
          n={2}
          done={status.rlusd.trustline}
          title="Accept RLUSD (digital dollars)"
          body={
            status.rlusd.trustline
              ? `Ready to receive${status.rlusd.balance ? ` · balance ${status.rlusd.balance} RLUSD` : ""}.`
              : hasSeed
                ? "One tap opens the line and signs you up for reputation points."
                : "Open your XRP wallet (e.g. Xaman, Crossmark) on testnet and add a trust line."
          }
          action={
            !status.rlusd.trustline &&
            (hasSeed ? (
              <Button size="sm" onClick={onboard} disabled={busy !== null}>
                <Coins className="size-4" aria-hidden /> {busy === "onboard" ? "Working…" : "Add RLUSD"}
              </Button>
            ) : (
              <Disclosure title="Show the trust line to add" className="bg-surface-2 ring-0">
                <div className="relative">
                  <pre className="overflow-auto rounded-[12px] bg-bg p-3 pr-11 font-mono text-[11.5px]">{trustSetJson}</pre>
                  <button
                    type="button"
                    aria-label="Copy trust line JSON"
                    onClick={async () => {
                      await navigator.clipboard?.writeText(trustSetJson);
                      toast.success("Copied");
                    }}
                    className="absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-surface text-muted ring-1 ring-line hover:text-ink"
                  >
                    <Copy className="size-4" aria-hidden />
                  </button>
                </div>
              </Disclosure>
            ))
          }
        />
        <Step
          n={3}
          done={status.reputation.opted_in}
          title="Collect reputation points"
          body={
            status.reputation.opted_in ? (
              <>
                {status.reputation.balance ?? "0"} verified answers on-ledger
                {status.reputation.minted < status.reputation.earned && (
                  <span className="block text-[12.5px] text-muted">
                    {status.reputation.earned - status.reputation.minted} more will be minted at the next draw.
                  </span>
                )}
                {status.reputation.explorer_url && (
                  <a
                    href={status.reputation.explorer_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex items-center gap-0.5 text-[12.5px] underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    AEYE points <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </>
            ) : hasSeed && status.rlusd.trustline ? (
              "You're opted in."
            ) : (
              "Points are minted to your wallet for each accepted answer."
            )
          }
          action={
            !status.reputation.opted_in &&
            hasSeed &&
            status.address && (
              <Button size="sm" variant="soft" onClick={onboard} disabled={busy !== null || !status.reputation.issuance_id}>
                <Sparkles className="size-4" aria-hidden /> {busy === "onboard" ? "Working…" : "Opt in"}
              </Button>
            )
          }
        />
      </ol>

      <div className="mt-4">
        {badge}
        {status.credential?.state === "issued" && hasSeed && status.issuer && (
          <Button size="sm" variant="soft" className="mt-3" onClick={acceptBadge} disabled={busy !== null}>
            <BadgeCheck className="size-4" aria-hidden /> {busy === "badge" ? "Accepting…" : "Accept badge"}
          </Button>
        )}
      </div>
    </Card>
  );
}

function Step({
  n,
  done,
  title,
  body,
  action,
}: {
  n: number;
  done: boolean;
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 rounded-[16px] bg-surface-2 p-3.5">
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold",
          done ? "bg-accent text-on-accent" : "bg-surface text-muted ring-1 ring-line",
        )}
        aria-hidden
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold tracking-tight">{title}</p>
        <div className="mt-0.5 text-[13px] leading-relaxed text-muted">{body}</div>
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </li>
  );
}
