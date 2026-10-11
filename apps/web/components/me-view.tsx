"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { ArrowRight, BadgeCheck, Bell, Camera, Check, ChevronRight, Coins, Flame, Lock, Target, Trophy, Wallet } from "lucide-react";
import { ago } from "@/lib/time";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";
import { celebrate } from "@/lib/confetti";
import { browserSupportsPasskeys, startPasskeyAuthentication, startPasskeyRegistration } from "@/lib/passkey-client";
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
import { Tabs } from "./ui/tabs";
import type { ObserverPrize } from "@a-eye/shared";
import { TestMoney } from "@/components/ui/test-money";

type Observer = { id: string; display_name: string; evm_address?: string; xrpl_address?: string; payout_rail: "evm" | "xrpl" };
type Account = { has_passkey: boolean; wallet: { address: string; source: "passkey" | "pasted" } | null };
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

const PRIZES_SEEN_KEY = "aeye:prizes-seen";

function readSeenPrizeIds(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PRIZES_SEEN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function testDollars(amount: number) {
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(amount)} test dollars`;
}

function shortAddress(address: string) {
  return `${address.slice(2, 6)}…${address.slice(-4)}`;
}

export function MeView() {
  const reduce = useReducedMotion();
  const [me, setMe] = useState<{
    observer: Observer;
    entries: Entry[];
    stats?: ObserverStats;
    xrpl?: Xrpl;
    account: Account;
    prizes: ObserverPrize[];
    passkey_wallet_enabled: boolean;
  } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState("");
  const [xrplAddress, setXrplAddress] = useState("");
  const [rail, setRail] = useState<"evm" | "xrpl">("evm");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errField, setErrField] = useState<"wallet" | "xrpl" | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState<"save" | "login" | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [prizes, setPrizes] = useState<ObserverPrize[]>([]);
  const [seenPrizes, setSeenPrizes] = useState<string[]>([]);
  const [recentlySeen, setRecentlySeen] = useState<string[]>([]);
  const [seenReady, setSeenReady] = useState(false);
  const [requestedPrize, setRequestedPrize] = useState<string | null>(null);
  const celebratedPrizes = useRef(new Set<string>());

  useEffect(() => {
    setSeenPrizes(readSeenPrizeIds());
    setSeenReady(true);
    setRequestedPrize(new URLSearchParams(window.location.search).get("prize"));
    void refreshMe().catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    if (!seenReady) return;
    const newPaid = prizes.filter(
      (prize) =>
        prize.status === "paid" && !seenPrizes.includes(prize.question_id) && !celebratedPrizes.current.has(prize.question_id),
    );
    if (!newPaid.length) return;
    newPaid.forEach((prize) => celebratedPrizes.current.add(prize.question_id));
    void celebrate();
    const added = newPaid.map((prize) => prize.question_id);
    const nextSeen = [...new Set([...seenPrizes, ...added])];
    setSeenPrizes(nextSeen);
    setRecentlySeen((current) => [...new Set([...current, ...added])]);
    try {
      localStorage.setItem(PRIZES_SEEN_KEY, JSON.stringify(nextSeen));
    } catch {}
    window.setTimeout(() => setRecentlySeen((current) => current.filter((id) => !added.includes(id))), 6000);
  }, [prizes, seenPrizes, seenReady]);

  async function refreshMe() {
    const res = await fetch("/api/me", { cache: "no-store" });
    if (!res.ok) throw new Error("Couldn't load your profile.");
    const data = await res.json();
    setMe(data);
    setName(data.observer.display_name);
    setWallet(data.observer.evm_address ?? "");
    setXrplAddress(data.observer.xrpl_address ?? "");
    setRail(data.observer.payout_rail ?? "evm");
    setPrizes(data.prizes ?? []);
    return data;
  }

  async function postJson(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
    return data;
  }

  async function savePasskey() {
    setPasskeyBusy("save");
    try {
      const { options } = await postJson("/api/auth/passkey/register/options", {});
      const response = await startPasskeyRegistration(options);
      await postJson("/api/auth/passkey/register", { response });
      await refreshMe();
      haptic("success");
      toast.success("Your account is saved", { description: "Use Face ID or your fingerprint to sign in again." });
    } catch (error) {
      toast.error("Couldn't save your account", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setPasskeyBusy(null);
    }
  }

  async function signInWithPasskey() {
    setPasskeyBusy("login");
    try {
      const { options } = await postJson("/api/auth/passkey/login/options", {});
      const response = await startPasskeyAuthentication(options);
      const result = await postJson("/api/auth/passkey/login", { response });
      await refreshMe();
      haptic("success");
      toast.success(`Welcome back, ${result.observer.display_name}`);
    } catch (error) {
      toast.error("Couldn't sign in", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setPasskeyBusy(null);
    }
  }

  async function createPrizeWallet(questionId?: string) {
    setWalletBusy(true);
    try {
      const selected = await postJson("/api/me/prize-wallet/options", {});
      if (selected.mode === "existing") {
        await refreshMe();
        toast.success("Your prize wallet is ready");
        return;
      }
      const response =
        selected.mode === "create"
          ? await startPasskeyRegistration(selected.options)
          : await startPasskeyAuthentication(selected.options);
      const result = await postJson("/api/me/prize-wallet", { mode: selected.mode, response });
      const refreshed = await refreshMe();
      setWallet(result.address);
      haptic("success");
      toast.success("Your prize wallet is ready", { description: "Winnings will be sent there automatically." });
      if (questionId || refreshed.prizes?.some((prize: ObserverPrize) => prize.rail === "ausd" && prize.status !== "paid")) {
        void pollPrizes(questionId);
      }
    } catch (error) {
      haptic("error");
      toast.error("Couldn't set up your prize wallet", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setWalletBusy(false);
    }
  }

  async function pollPrizes(questionId?: string) {
    const deadline = Date.now() + 2 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      try {
        const res = await fetch("/api/me/prizes", { cache: "no-store" });
        if (!res.ok) continue;
        const data = (await res.json()) as { prizes: ObserverPrize[] };
        setPrizes(data.prizes);
        const target = questionId ? data.prizes.find((prize) => prize.question_id === questionId) : undefined;
        if (questionId ? target?.status === "paid" : data.prizes.every((prize) => prize.rail !== "ausd" || prize.status === "paid")) break;
      } catch {
        continue;
      }
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Same checks as app/api/me/route.ts, so typos are flagged without a 400 round trip.
    const w = wallet.trim();
    const x = xrplAddress.trim();
    const fail = (field: "wallet" | "xrpl", msg: string) => {
      setErr(msg);
      setErrField(field);
      haptic("error");
      document.getElementById(field)?.focus();
    };
    if (w && !/^0x[a-fA-F0-9]{40}$/.test(w)) return fail("wallet", "Use a 0x address with 40 hex characters.");
    if (rail === "xrpl" && !x) return fail("xrpl", "Add an XRPL address to get paid on XRPL.");
    if (x && !/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(x)) return fail("xrpl", "Use a classic XRPL address starting with r.");
    setSaving(true);
    setErr(null);
    setErrField(null);
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
      setMe((m) => (m ? { ...m, observer: j.observer, xrpl: j.xrpl, account: j.account } : m));
    } else {
      haptic("error");
      setErr(j.error);
      setErrField(null);
    }
  }

  const entries = me?.entries ?? [];
  const wins = entries.filter((e) => e.won);
  const hasWallet = Boolean(me?.observer.evm_address || me?.observer.xrpl_address);
  const visiblePrizes = prizes
    .filter((prize) => prize.status !== "paid" || !seenPrizes.includes(prize.question_id) || recentlySeen.includes(prize.question_id))
    .sort((a, b) => Date.parse(b.won_at) - Date.parse(a.won_at));
  if (requestedPrize) {
    visiblePrizes.sort((a, b) => Number(b.question_id === requestedPrize) - Number(a.question_id === requestedPrize));
  }
  const featuredPrize = visiblePrizes[0];

  async function collectPrize(prize: ObserverPrize) {
    if (prize.rail === "xrpl") return;
    await createPrizeWallet(prize.question_id);
  }

  const answersTab = (
    <>
      {entries.some((e) => e.status === "open") && (
        <p className="mb-3 flex items-start gap-2.5 rounded-[16px] bg-surface-2 px-4 py-3 text-[13.5px] leading-snug text-muted">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Your answer is locked in. Everyone&apos;s answers stay hidden until the question closes, so no one can copy the crowd. Then
            one person who answered wins {Math.round((1 - PLATFORM_FEE) * 100)}% of the pot.
          </span>
        </p>
      )}
      {!me && !loadError && (
        <div className="grid gap-2.5" aria-busy aria-label="Loading answers">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[76px] rounded-[18px]" />
          ))}
        </div>
      )}
      {me && entries.length === 0 && (
        <EmptyState
          icon={<Camera className="size-7" aria-hidden />}
          title="No answers yet"
          body="Pick any pin on the map and snap a photo. Every photo is one entry in that question's prize draw."
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
          <ul className="grid gap-2.5">
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
    </>
  );

  const badgesTab = (
    <div className="grid gap-4">
      {me?.stats ? <BadgeGrid badges={me.stats.badges} /> : <Skeleton className="h-40 rounded-[18px]" />}
      {me?.xrpl && <CredentialBadge xrpl={me.xrpl} hasAddress={Boolean(me.observer.xrpl_address)} />}
      <Button asChild variant="secondary" block>
        <Link href="/leaderboard">
          <Trophy className="size-4" aria-hidden /> See the leaderboard <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>
    </div>
  );

  const payTab = (
    <div className="grid gap-4">
      {loadError ? (
        <p className="rounded-[14px] bg-bad-soft px-3.5 py-3 text-[14px] text-bad">Couldn&apos;t load your profile. Refresh to try again.</p>
      ) : !me ? (
        <div className="grid gap-4" aria-label="Loading profile" aria-busy>
          <Card className="grid gap-5 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-[46px] rounded-[14px]" />
                <Skeleton className="h-3.5 w-56" />
              </div>
            ))}
            <Skeleton className="h-[52px] rounded-full" />
          </Card>
          <Card className="grid gap-2 p-5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-64" />
          </Card>
        </div>
      ) : (
        <Card className="p-5">
          {me.account.wallet?.source === "passkey" ? (
            <div className="mb-5 rounded-[16px] bg-accent-soft p-4 text-accent-ink">
              <p className="flex items-center gap-2 font-semibold">
                <Check className="size-4" aria-hidden /> Your prize wallet is ready
              </p>
              <p className="mt-2 font-mono text-[13px]">{shortAddress(me.account.wallet.address)}</p>
              <p className="mt-1 text-[13px]">Made with your passkey</p>
            </div>
          ) : !me.observer.evm_address && me.passkey_wallet_enabled ? (
            <div className="mb-5 rounded-[16px] bg-accent-soft p-4">
              <p className="font-semibold">One tap, and you&apos;re ready to collect</p>
              <p className="mt-1 text-[13.5px] text-muted">Use Face ID or your fingerprint to set up a prize wallet.</p>
              <Button className="mt-3" disabled={walletBusy} onClick={() => void createPrizeWallet()}>
                <Wallet className="size-4" aria-hidden /> {walletBusy ? "Setting up…" : "Create my prize wallet"}
              </Button>
            </div>
          ) : hasWallet ? (
            <p className="mb-5 rounded-[16px] bg-surface-2 p-4 text-[14px] text-muted">Your payout details are saved.</p>
          ) : (
            <p className="mb-5 rounded-[16px] bg-surface-2 p-4 text-[14px] text-muted">Add payout details in Advanced when you&apos;re ready.</p>
          )}
          <form onSubmit={save} className="grid gap-4">
            <div className="grid gap-2">
              <label htmlFor="display-name" className="text-[14px] font-semibold">
                Your name
              </label>
              <input
                id="display-name"
                name="display_name"
                autoComplete="nickname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                maxLength={40}
                className="field"
              />
              <p className="text-[13px] text-muted">Shown under your photos.</p>
            </div>
            <Disclosure title="Advanced" className="bg-surface-2 ring-0">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <label htmlFor="wallet" className="text-[14px] font-semibold">
                    Where should we send winnings?
                  </label>
                  <input
                    id="wallet"
                    name="evm_address"
                    autoComplete="off"
                    value={wallet}
                    onChange={(e) => {
                      setWallet(e.target.value);
                      if (errField === "wallet") {
                        setErrField(null);
                        setErr(null);
                      }
                    }}
                    className="field font-mono text-[14px]"
                    placeholder="0x…"
                    spellCheck={false}
                    autoCapitalize="off"
                    aria-invalid={errField === "wallet" || undefined}
                    aria-describedby={errField === "wallet" ? "wallet-help me-error" : "wallet-help"}
                  />
                  <p id="wallet-help" className="text-[13px] text-muted">
                    Paste a wallet address. Optional until you win.
                  </p>
                </div>
                <fieldset className="grid gap-2">
                  <legend className="mb-2 text-[14px] font-semibold">Get paid in</legend>
                  <div className="grid grid-cols-2 gap-1 rounded-full bg-surface p-1" role="radiogroup">
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
                          rail === value ? "bg-surface-2 text-ink shadow-panel" : "text-muted",
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
                      name="xrpl_address"
                      autoComplete="off"
                      value={xrplAddress}
                      onChange={(e) => {
                        setXrplAddress(e.target.value);
                        if (errField === "xrpl") {
                          setErrField(null);
                          setErr(null);
                        }
                      }}
                      className="field font-mono text-[14px]"
                      placeholder="r…"
                      spellCheck={false}
                      autoCapitalize="off"
                      aria-invalid={errField === "xrpl" || undefined}
                      aria-describedby={errField === "xrpl" ? "xrpl-help me-error" : "xrpl-help"}
                    />
                    <p id="xrpl-help" className="text-[13px] text-muted">
                      Starts with r. Also earns you a Verified Observer badge after {me.xrpl?.threshold ?? 3} answers.
                    </p>
                  </div>
                )}
                {me.xrpl && (rail === "xrpl" || me.observer.xrpl_address) && (
                  <XrplWalletSetup
                    badge={<CredentialBadge xrpl={me.xrpl} hasAddress={Boolean(me.observer.xrpl_address)} />}
                    onAddress={(address) => {
                      setXrplAddress(address);
                      setRail("xrpl");
                      setMe((current) =>
                        current ? { ...current, observer: { ...current.observer, xrpl_address: address, payout_rail: "xrpl" } } : current,
                      );
                    }}
                  />
                )}
                <Disclosure title="Wallet details" className="bg-surface ring-0">
                  <p className="text-[13.5px] leading-relaxed text-muted">
                    Any wallet address works. Test dollars use the AUSD token on Base Sepolia. XRP Ledger prizes are paid in RLUSD, or XRP
                    if you don&apos;t have an RLUSD trust line.
                  </p>
                </Disclosure>
              </div>
            </Disclosure>
            {err && (
              <p id="me-error" role="alert" className="rounded-[12px] bg-bad-soft px-3 py-2.5 text-[14px] text-bad">
                {err}
              </p>
            )}
            <Button type="submit" disabled={saving} size="lg" block>
              {saving ? "Saving…" : "Save"}
            </Button>
          </form>
        </Card>
      )}
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold tracking-tight">
          <Bell className="size-4" aria-hidden /> Alerts
        </h2>
        <p className="mt-1 text-[13.5px] text-muted">Get a heads-up when a new question pops up near you.</p>
        <PushOptIn />
      </Card>
    </div>
  );

  const greeting = !me ? "Hi there" : `Hi, ${name || "friend"}`;

  return (
    <main className="mx-auto grid max-w-[1200px] gap-6 px-4 pb-24 pt-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12 md:px-6 md:pt-12">
      <section className="md:sticky md:top-[84px] md:self-start">
        <div className="flex items-center gap-4">
          <span className="grid size-16 shrink-0 place-items-center rounded-[22px] bg-gradient-to-br from-accent to-accent-2 text-[26px] font-bold text-white shadow-lift">
            {(name || "?").trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight">{greeting}</h1>
            {me?.account.has_passkey ? (
              <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-[12.5px] font-medium text-ok">
                <Check className="size-3.5" aria-hidden /> Saved with your passkey
              </p>
            ) : me ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted">
                <span>{browserSupportsPasskeys() ? "Save your account with Face ID or fingerprint" : "This browser can’t save passkeys."}</span>
                <button type="button" className="font-semibold text-accent-ink underline underline-offset-4" onClick={() => void savePasskey()} disabled={passkeyBusy !== null}>
                  {passkeyBusy === "save" ? "Saving…" : "Save"}
                </button>
                <button type="button" className="font-semibold text-accent-ink underline underline-offset-4" onClick={() => void signInWithPasskey()} disabled={passkeyBusy !== null}>
                  {passkeyBusy === "login" ? "Signing in…" : "Sign in"}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {featuredPrize && me && (
          <Card className="mt-4 bg-accent-soft p-4 ring-accent/20">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-accent-ink">
              <Trophy className="size-4" aria-hidden />
              {featuredPrize.status === "paid" ? "You got your prize!" : "Your prize is waiting"}
            </p>
            <p className="mt-1 text-[14px] text-muted">
              {testDollars(featuredPrize.amount)}
              {featuredPrize.place_label ? ` at ${featuredPrize.place_label}` : ""}
            </p>
            {visiblePrizes.length > 1 && <p className="mt-1 text-[12.5px] text-muted">and {visiblePrizes.length - 1} more</p>}
            {featuredPrize.status === "needs_wallet" && featuredPrize.rail === "ausd" ? (
              <Button className="mt-3" disabled={walletBusy || !me.passkey_wallet_enabled} onClick={() => void collectPrize(featuredPrize)}>
                <Wallet className="size-4" aria-hidden />
                {walletBusy ? "Setting up…" : "Collect my prize"}
              </Button>
            ) : featuredPrize.status === "paid" && featuredPrize.receipt_url ? (
              <Button asChild variant="secondary" className="mt-3">
                <a href={featuredPrize.receipt_url} target="_blank" rel="noreferrer">
                  Paid! See receipt
                </a>
              </Button>
            ) : (
              <Button className="mt-3" disabled>
                On its way…
              </Button>
            )}
          </Card>
        )}

        <dl className="mt-5 grid grid-cols-6 gap-2">
          <Stat icon={<Camera className="size-4" aria-hidden />} label="Answers" value={me ? (me.stats?.verified_answers ?? entries.length) : undefined} />
          <Stat
            icon={<Trophy className="size-4" aria-hidden />}
            label="Wins"
            value={me ? (me.stats?.questions_won ?? wins.length) : undefined}
            hot={(me?.stats?.questions_won ?? wins.length) > 0}
          />
          <Stat
            icon={<Flame className="size-4" aria-hidden />}
            label="Streak"
            value={me ? (me.stats?.current_streak ?? 0) : undefined}
            hint={me?.stats && me.stats.best_streak > me.stats.current_streak ? `Best ${me.stats.best_streak}` : undefined}
          />
          <Stat icon={<Coins className="size-4" aria-hidden />} label={
              <>
                Test dollars earned <TestMoney className="ml-auto" align="end" />
              </>
            } value={me ? (me.stats?.ausd_earned ?? 0) : undefined} wide />
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

        {me && !me.observer.evm_address && (
          <a
            href="#pay"
            className="mt-4 flex min-h-14 items-center gap-3 rounded-[18px] bg-accent-soft px-4 py-3 text-accent-ink transition-transform active:scale-[0.985]"
          >
            <Wallet className="size-5 shrink-0" aria-hidden />
            <span className="flex-1 text-[14px] leading-snug">
              <b className="font-semibold">{me.passkey_wallet_enabled ? "Create your prize wallet" : "Choose how to get paid"}</b>{" "}
              {me.passkey_wallet_enabled ? "with Face ID in one tap." : "in Get paid."}
            </span>
            <ChevronRight className="size-4 shrink-0" aria-hidden />
          </a>
        )}
      </section>

      <section aria-label="Your activity" className="min-w-0">
        <Tabs
          hashSync
          label="Your profile"
          items={[
            { value: "answers", label: "Answers", count: me ? entries.length : undefined, content: answersTab },
            { value: "badges", label: "Badges", content: badgesTab },
            { value: "pay", label: "Get paid", content: payTab },
          ]}
        />
      </section>
    </main>
  );
}

function EntryBadge({ e }: { e: Entry }) {
  if (e.won)
    return (
      <Badge tone="solid" size="md">
        <Trophy className="size-3.5" aria-hidden /> Won {e.prize} {e.currency === "AUSD" || e.currency === "RLUSD" ? "test dollars" : e.currency}
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
  label: React.ReactNode;
  value?: number | string;
  hint?: string;
  hot?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "col-span-2 min-w-0 rounded-[18px] p-3",
        hot ? "bg-accent-soft text-accent-ink" : "bg-surface ring-1 ring-line",
        wide && "col-span-3",
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
        <dd className="mt-1 block text-[22px] font-bold tabular-nums tracking-tight">{value}</dd>
      )}
      {hint && <dd className={cn("mt-0.5 text-[12px]", hot ? "" : "text-muted")}>{hint}</dd>}
    </div>
  );
}

function CredentialBadge({ xrpl, hasAddress }: { xrpl: Xrpl; hasAddress: boolean }) {
  const issued = xrpl.credential?.state === "issued";
  const progress = Math.min(xrpl.accepted, xrpl.threshold);
  return (
    <Card className={cn("p-5", issued && "bg-accent-soft ring-transparent")}>
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
