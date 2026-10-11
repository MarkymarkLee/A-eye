"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { ArrowRight, Camera, ChevronRight, Clock, Trophy, Wallet } from "lucide-react";
import { ago } from "@/lib/time";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Disclosure } from "./ui/disclosure";
import { EmptyState } from "./ui/empty-state";
import { Skeleton } from "./ui/skeleton";

type Observer = { id: string; display_name: string; evm_address?: string };
type Entry = {
  submission_id: string;
  question_id: string;
  prompt: string;
  answer: string;
  captured_at: string;
  status: string;
  won: boolean;
  prize: number;
  currency: string;
};

export function MeView() {
  const reduce = useReducedMotion();
  const [me, setMe] = useState<{ observer: Observer; entries: Entry[] } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setMe(j);
        setName(j.observer.display_name);
        setWallet(j.observer.evm_address ?? "");
      })
      .catch(() => setLoadError(true));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const res = await fetch("/api/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: name, evm_address: wallet.trim() }),
    });
    const j = await res.json();
    setSaving(false);
    if (res.ok) {
      haptic("success");
      toast.success("Saved", { description: wallet.trim() ? "Winnings will go to this wallet." : undefined });
      setMe((m) => (m ? { ...m, observer: j.observer } : m));
    } else {
      haptic("error");
      setErr(j.error);
    }
  }

  const entries = me?.entries ?? [];
  const wins = entries.filter((e) => e.won);
  const pending = entries.filter((e) => e.status === "open").length;
  const hasWallet = Boolean(me?.observer.evm_address);

  return (
    <main className="mx-auto grid max-w-[1100px] gap-8 px-4 pb-24 pt-6 md:grid-cols-[5fr_7fr] md:gap-12 md:px-6 md:pt-12">
      <section>
        <div className="flex items-center gap-4">
          <span className="grid size-16 shrink-0 place-items-center rounded-[22px] bg-gradient-to-br from-accent to-accent-2 text-[26px] font-bold text-white shadow-lift">
            {(name || "?").trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight">{me ? name || "You" : "You"}</h1>
            <p className="text-[14px] text-muted">No sign-up needed. This browser is your account.</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2">
          <Stat icon={<Camera className="size-4" aria-hidden />} label="Answers" value={me ? entries.length : undefined} />
          <Stat icon={<Clock className="size-4" aria-hidden />} label="Draws pending" value={me ? pending : undefined} />
          <Stat icon={<Trophy className="size-4" aria-hidden />} label="Wins" value={me ? wins.length : undefined} hot={wins.length > 0} />
        </div>

        {loadError ? (
          <p className="mt-8 rounded-[14px] bg-bad-soft px-3.5 py-3 text-[14px] text-bad">
            Couldn&apos;t load your profile. Refresh to try again.
          </p>
        ) : !me ? (
          <div className="mt-8 grid gap-4" aria-label="Loading profile" aria-busy>
            <Skeleton className="h-12 rounded-[14px]" />
            <Skeleton className="h-12 rounded-[14px]" />
          </div>
        ) : (
          <Card className="mt-6 p-5">
            {!hasWallet && (
              <p className="mb-4 flex items-start gap-2.5 rounded-[14px] bg-accent-soft p-3 text-[14px] leading-snug text-accent-ink">
                <Wallet className="mt-0.5 size-4 shrink-0" aria-hidden />
                Add a wallet so we know where to send your prize if you win.
              </p>
            )}
            <form onSubmit={save} className="grid gap-5">
              <div className="grid gap-2">
                <label htmlFor="name" className="text-[14px] font-semibold">
                  Your name
                </label>
                <input id="name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={40} className="field" />
                <p className="text-[13px] text-muted">Shown under your photos.</p>
              </div>
              <div className="grid gap-2">
                <label htmlFor="wallet" className="text-[14px] font-semibold">
                  Where should we send winnings?
                </label>
                <input
                  id="wallet"
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  className="field font-mono text-[14px]"
                  placeholder="0x…"
                  spellCheck={false}
                  autoCapitalize="off"
                  aria-describedby="wallet-help"
                />
                <p id="wallet-help" className="text-[13px] text-muted">
                  Paste a crypto wallet address (it starts with 0x). Optional until you win.
                </p>
              </div>
              {err && (
                <p role="alert" className="rounded-[12px] bg-bad-soft px-3 py-2.5 text-[14px] text-bad">
                  {err}
                </p>
              )}
              <Button type="submit" disabled={saving} size="lg" block>
                {saving ? "Saving…" : "Save"}
              </Button>
            </form>
            <Disclosure title="What kind of wallet?" className="mt-4 bg-surface-2 ring-0">
              <p className="text-[13.5px] leading-relaxed text-muted">
                Any EVM address works (MetaMask, Coinbase Wallet, Rainbow…). Prizes are paid in AUSD, a dollar stablecoin, on the Base
                Sepolia test network.
              </p>
            </Disclosure>
          </Card>
        )}
      </section>

      <section>
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Your answers</h2>
        {!me && !loadError && (
          <div className="mt-3 grid gap-2.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[76px] rounded-[18px]" />
            ))}
          </div>
        )}
        {me && entries.length === 0 && (
          <EmptyState
            className="mt-3"
            icon={<Camera className="size-7" aria-hidden />}
            title="No answers yet"
            body="Every photo you send is one entry in that question's prize draw."
            action={
              <Button asChild>
                <Link href="/">
                  Find questions near you <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            }
          />
        )}
        {entries.length > 0 && (
          <ul className="mt-3 grid gap-2.5">
            {entries.map((e, i) => (
              <motion.li
                key={e.submission_id}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <Link
                  href={`/q/${e.question_id}`}
                  transitionTypes={["nav-forward"]}
                  className={cn(
                    "flex items-center gap-3 rounded-[18px] bg-surface p-4 shadow-panel ring-1 transition-transform active:scale-[0.985]",
                    e.won ? "ring-accent/50" : "ring-line",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 font-semibold leading-snug tracking-tight">{e.prompt}</span>
                    <span className="mt-1 block text-[13px] text-muted">
                      You said &ldquo;{e.answer}&rdquo; · {ago(e.captured_at)}
                    </span>
                  </span>
                  <EntryBadge e={e} />
                  <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                </Link>
              </motion.li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function EntryBadge({ e }: { e: Entry }) {
  if (e.won)
    return (
      <Badge tone="solid" size="md">
        <Trophy className="size-3.5" aria-hidden /> Won {e.prize} {e.currency}
      </Badge>
    );
  if (e.status === "open") return <Badge tone="sky">Draw pending</Badge>;
  if (e.status === "expired") return <Badge>No draw</Badge>;
  return <Badge>Not this time</Badge>;
}

function Stat({ icon, label, value, hot }: { icon: React.ReactNode; label: string; value?: number; hot?: boolean }) {
  return (
    <div className={cn("rounded-[18px] p-3.5", hot ? "bg-accent-soft text-accent-ink" : "bg-surface ring-1 ring-line")}>
      <span className={cn("flex items-center gap-1.5 text-[12px] font-medium", hot ? "" : "text-muted")}>
        {icon}
        {label}
      </span>
      {value === undefined ? (
        <Skeleton className="mt-2 h-6 w-8" />
      ) : (
        <span className="mt-1 block text-[24px] font-bold tabular-nums tracking-tight">{value}</span>
      )}
    </div>
  );
}
