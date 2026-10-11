"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { ArrowRight, BadgeCheck, Bell, Camera, ChevronRight, Coins, Flame, Lock, Target, Trophy, Wallet } from "lucide-react";
import { ago } from "@/lib/time";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Disclosure } from "./ui/disclosure";
import { EmptyState } from "./ui/empty-state";
import { PLATFORM_FEE } from "@a-eye/shared";
import type { ObserverStats } from "@/lib/reputation";
import { BadgeGrid, pct } from "./badges";
import { PushOptIn } from "./push-opt-in";
import { XrplWalletSetup } from "./xrpl-wallet-setup";
import { Skeleton } from "./ui/skeleton";

type Observer = { id: string; display_name: string; evm_address?: string; xrpl_address?: string; payout_rail: "evm" | "xrpl" };
type Xrpl = {
  enabled: boolean;
  accepted: number;
  threshold: number;
  credential?: { subject: string; state: "pending" | "issued" | "failed"; tx?: string; url?: string };
};
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
  const [me, setMe] = useState<{ observer: Observer; entries: Entry[]; stats?: ObserverStats; xrpl?: Xrpl } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState("");
  const [xrplAddress, setXrplAddress] = useState("");
  const [rail, setRail] = useState<"evm" | "xrpl">("evm");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setMe(j);
        setName(j.observer.display_name);
        setWallet(j.observer.evm_address ?? "");
        setXrplAddress(j.observer.xrpl_address ?? "");
        setRail(j.observer.payout_rail ?? "evm");
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
      body: JSON.stringify({ display_name: name, evm_address: wallet.trim(), xrpl_address: xrplAddress.trim(), payout_rail: rail }),
    });
    const j = await res.json();
    setSaving(false);
    if (res.ok) {
      haptic("success");
      toast.success("Saved", { description: wallet.trim() || xrplAddress.trim() ? "Winnings will go to this wallet." : undefined });
      setMe((m) => (m ? { ...m, observer: j.observer, xrpl: j.xrpl } : m));
    } else {
      haptic("error");
      setErr(j.error);
    }
  }

  const entries = me?.entries ?? [];
  const wins = entries.filter((e) => e.won);
  const hasWallet = Boolean(me?.observer.evm_address || me?.observer.xrpl_address);

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

        <dl className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
          <Stat icon={<Camera className="size-4" aria-hidden />} label="Verified answers" value={me ? (me.stats?.verified_answers ?? entries.length) : undefined} />
          <Stat
            icon={<Trophy className="size-4" aria-hidden />}
            label="Questions won"
            value={me ? (me.stats?.questions_won ?? wins.length) : undefined}
            hot={(me?.stats?.questions_won ?? wins.length) > 0}
          />
          <Stat icon={<Coins className="size-4" aria-hidden />} label="AUSD earned" value={me ? (me.stats?.ausd_earned ?? 0) : undefined} />
          <Stat
            icon={<Flame className="size-4" aria-hidden />}
            label="Day streak"
            value={me ? (me.stats?.current_streak ?? 0) : undefined}
            hint={me?.stats && me.stats.best_streak > me.stats.current_streak ? `Best ${me.stats.best_streak}` : undefined}
          />
          <Stat
            icon={<Target className="size-4" aria-hidden />}
            label="Agreement"
            value={me ? pct(me.stats?.agreement_rate ?? null) : undefined}
            hint={
              me?.stats && me.stats.agreement_scored > 0
                ? `${me.stats.agreement_agreed} of ${me.stats.agreement_scored} closed`
                : "After a question closes"
            }
            wide
          />
        </dl>

        {me?.stats && (
          <div className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[16px] font-semibold tracking-tight">Badges</h2>
              <Link
                href="/leaderboard"
                className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-[14px] font-semibold text-accent-ink hover:underline"
              >
                Leaderboard <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <div className="mt-3">
              <BadgeGrid badges={me.stats.badges} />
            </div>
          </div>
        )}

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
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-[14px] font-semibold">Get paid in</legend>
                <div className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1" role="radiogroup">
                  {(
                    [
                      ["evm", "Digital dollars"],
                      ["xrpl", "RLUSD (XRP Ledger)"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className={cn(
                        "relative grid h-10 cursor-pointer place-items-center rounded-full text-[14px] font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                        rail === value ? "bg-surface text-ink shadow-panel" : "text-muted",
                      )}
                    >
                      <input
                        type="radio"
                        name="payout_rail"
                        value={value}
                        checked={rail === value}
                        onChange={() => setRail(value)}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {me.xrpl && !me.xrpl.enabled && rail === "xrpl" && (
                  <p className="text-[13px] text-muted">RLUSD payouts aren&apos;t switched on here yet, so you&apos;ll get digital dollars instead.</p>
                )}
              </fieldset>
              {rail === "xrpl" && (
                <div className="grid gap-2">
                  <label htmlFor="xrpl" className="text-[14px] font-semibold">
                    XRP wallet address
                  </label>
                  <input
                    id="xrpl"
                    value={xrplAddress}
                    onChange={(e) => setXrplAddress(e.target.value)}
                    className="field font-mono text-[14px]"
                    placeholder="r…"
                    spellCheck={false}
                    autoCapitalize="off"
                    aria-describedby="xrpl-help"
                  />
                  <p id="xrpl-help" className="text-[13px] text-muted">
                    Starts with r. Also earns you a Verified Observer badge after {me.xrpl?.threshold ?? 3} answers.
                  </p>
                </div>
              )}
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
                Any EVM address works (MetaMask, Coinbase Wallet, Rainbow…). Digital dollars are AUSD, a dollar stablecoin, on the Base
                Sepolia test network. Prizes are locked in an XRP Ledger escrow and paid to you in RLUSD, a dollar stablecoin, when you
                win. No RLUSD trust line? You get XRP instead.
              </p>
            </Disclosure>
          </Card>
        )}
        {me?.xrpl && (rail === "xrpl" || me.observer.xrpl_address) && (
          <XrplWalletSetup
            badge={<CredentialBadge xrpl={me.xrpl} hasAddress={Boolean(me.observer.xrpl_address)} />}
            onAddress={(address) => {
              setXrplAddress(address);
              setRail("xrpl");
              setMe((m) => (m ? { ...m, observer: { ...m.observer, xrpl_address: address, payout_rail: "xrpl" } } : m));
            }}
          />
        )}
        {me?.xrpl && !(rail === "xrpl" || me.observer.xrpl_address) && (
          <CredentialBadge xrpl={me.xrpl} hasAddress={Boolean(me.observer.xrpl_address)} />
        )}

        <Card className="mt-4 p-5">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold tracking-tight">
            <Bell className="size-4" aria-hidden /> Alerts
          </h2>
          <p className="mt-1 text-[13.5px] text-muted">Get a heads-up when a new question pops up near you.</p>
          <PushOptIn />
        </Card>
      </section>

      <section>
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Your answers</h2>
        {entries.some((e) => e.status === "open") && (
          <p className="mt-3 flex items-start gap-2.5 rounded-[16px] bg-surface-2 px-4 py-3 text-[13.5px] leading-snug text-muted">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Your answer is locked in. Everyone&apos;s answers stay hidden until the question closes, so no one can copy the crowd. Then
              one person who answered wins {Math.round((1 - PLATFORM_FEE) * 100)}% of the pot.
            </span>
          </p>
        )}
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

function Stat({
  icon,
  label,
  value,
  hint,
  hot,
  wide,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number | string;
  hint?: string;
  hot?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] p-3.5",
        hot ? "bg-accent-soft text-accent-ink" : "bg-surface ring-1 ring-line",
        wide && "col-span-2 sm:col-span-1 md:col-span-2 lg:col-span-1",
      )}
    >
      <dt className={cn("flex items-center gap-1.5 text-[12px] font-medium", hot ? "" : "text-muted")}>
        {icon}
        {label}
      </dt>
      {value === undefined ? (
        <dd>
          <Skeleton className="mt-2 h-6 w-8" />
        </dd>
      ) : (
        <dd className="mt-1 block text-[24px] font-bold tabular-nums tracking-tight">{value}</dd>
      )}
      {hint && <dd className={cn("mt-0.5 text-[12px]", hot ? "" : "text-muted")}>{hint}</dd>}
    </div>
  );
}

function CredentialBadge({ xrpl, hasAddress }: { xrpl: Xrpl; hasAddress: boolean }) {
  const issued = xrpl.credential?.state === "issued";
  const progress = Math.min(xrpl.accepted, xrpl.threshold);
  return (
    <Card className={cn("mt-4 p-5", issued && "bg-accent-soft ring-transparent")}>
      <p className={cn("flex items-center gap-2 text-[16px] font-semibold tracking-tight", issued && "text-accent-ink")}>
        <BadgeCheck className="size-5" aria-hidden /> Verified Observer
      </p>
      <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
        {issued
          ? "You've earned it. It's recorded on the XRP Ledger under your address."
          : xrpl.credential?.state === "pending"
            ? "Issuing your badge now…"
            : !xrpl.enabled
              ? "Badges aren't switched on here yet."
              : !hasAddress
                ? "Add an XRP wallet address to earn this badge."
                : `${progress} of ${xrpl.threshold} accepted answers.`}
      </p>
      {!issued && xrpl.enabled && hasAddress && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2" style={{ width: `${(progress / xrpl.threshold) * 100}%` }} />
        </div>
      )}
      {xrpl.credential?.subject && (
        <p className="mt-2 truncate font-mono text-[12.5px] text-muted" title={xrpl.credential.subject}>
          {xrpl.credential.subject}
        </p>
      )}
      {xrpl.credential?.url && (
        <a
          href={xrpl.credential.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block font-mono text-[12.5px] underline decoration-line underline-offset-4 hover:decoration-ink"
        >
          CredentialCreate {xrpl.credential.tx!.slice(0, 10)}...
        </a>
      )}
    </Card>
  );
}
