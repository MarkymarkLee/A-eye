"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Trophy } from "@phosphor-icons/react";
import { ago } from "@/lib/time";
import type { ObserverStats } from "@/lib/reputation";
import { BadgeGrid, pct } from "./badges";
import { PushOptIn } from "./push-opt-in";

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
  const [me, setMe] = useState<{ observer: Observer; entries: Entry[]; stats: ObserverStats } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
    setMsg(null);
    const res = await fetch("/api/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: name, evm_address: wallet.trim() }),
    });
    const j = await res.json();
    setSaving(false);
    setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: j.error });
  }

  const wins = me?.entries.filter((e) => e.won) ?? [];

  return (
    <main className="mx-auto grid max-w-[1100px] gap-12 px-4 pb-24 pt-8 md:grid-cols-[5fr_7fr] md:px-6 md:pt-12">
      <section className="md:col-span-2">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Your observer profile</h1>
            <p className="mt-2 max-w-[44ch] text-[15px] leading-relaxed text-muted">
              For now your identity is this browser. Raffle winnings go to the wallet below.
            </p>
          </div>
          <Link href="/leaderboard" className="btn btn-ghost">
            Leaderboard <ArrowRight size={16} weight="bold" />
          </Link>
        </div>
        {me ? (
          <>
            <dl className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Verified answers" value={me.stats.verified_answers} />
              <Stat label="Questions won" value={me.stats.questions_won} />
              <Stat label="AUSD earned" value={me.stats.ausd_earned} />
              <Stat
                label="Day streak"
                value={me.stats.current_streak}
                hint={me.stats.best_streak > me.stats.current_streak ? `Best ${me.stats.best_streak}` : undefined}
              />
              <Stat
                label="Agreement"
                value={pct(me.stats.agreement_rate)}
                hint={
                  me.stats.agreement_scored > 0
                    ? `${me.stats.agreement_agreed} of ${me.stats.agreement_scored} closed`
                    : "After a question closes"
                }
                wide
              />
            </dl>
            <h2 className="mt-8 text-[15px] font-semibold tracking-tight">Badges</h2>
            <div className="mt-3">
              <BadgeGrid badges={me.stats.badges} />
            </div>
          </>
        ) : (
          !loadError && <div className="mt-8 h-24 animate-pulse rounded-[16px] bg-surface-2" aria-hidden />
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">Profile</h2>
        {loadError ? (
          <p className="mt-5 text-[14px] text-bad">Couldn&apos;t load your profile. Refresh to try again.</p>
        ) : !me ? (
          <div className="mt-5 space-y-4" aria-label="Loading profile">
            <div className="h-11 animate-pulse rounded-[12px] bg-surface-2" />
            <div className="h-11 animate-pulse rounded-[12px] bg-surface-2" />
          </div>
        ) : (
          <form onSubmit={save} className="mt-5 grid gap-5">
            <div className="grid gap-2">
              <label htmlFor="name" className="text-[14px] font-medium">
                Display name
              </label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={40} className="field" />
              <p className="text-[13px] text-muted">Shown under your photos in results.</p>
            </div>
            <div className="grid gap-2">
              <label htmlFor="wallet" className="text-[14px] font-medium">
                Payout wallet (Base Sepolia)
              </label>
              <input
                id="wallet"
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                className="field font-mono text-[14px]"
                placeholder="0x..."
                spellCheck={false}
                autoCapitalize="off"
                aria-describedby="wallet-help"
              />
              <p id="wallet-help" className="text-[13px] text-muted">
                Any EVM address. Winnings are paid in AUSD.
              </p>
            </div>
            {msg && (
              <p role="status" className={`text-[14px] ${msg.ok ? "text-ok" : "text-bad"}`}>
                {msg.text}
              </p>
            )}
            <button type="submit" disabled={saving} className="btn btn-primary justify-self-start">
              {saving ? "Saving" : "Save profile"}
            </button>
          </form>
        )}

        <div className="mt-10">
          <h2 className="text-xl font-semibold tracking-tight">Alerts</h2>
          <p className="mt-1 text-[13px] text-muted">Get a notification when a new question pops up near you.</p>
          <PushOptIn />
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-tight">Your answers</h2>
          {wins.length > 0 && (
            <p className="inline-flex items-center gap-1.5 text-[14px] font-medium text-accent-ink">
              <Trophy size={16} weight="fill" /> {wins.length} {wins.length === 1 ? "win" : "wins"}
            </p>
          )}
        </div>
        {me && me.entries.length === 0 && (
          <div className="mt-5 rounded-[16px] border border-dashed border-line px-5 py-8">
            <p className="text-lg font-medium">No answers yet.</p>
            <p className="mt-1 text-[14px] text-muted">Each verified answer is one raffle entry.</p>
            <Link href="/" className="btn btn-ghost mt-5">
              Find questions near you <ArrowRight size={16} weight="bold" />
            </Link>
          </div>
        )}
        {me && me.entries.length > 0 && (
          <ul className="mt-4 divide-y divide-line">
            {me.entries.map((e) => (
              <li key={e.submission_id}>
                <Link href={`/q/${e.question_id}`} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 py-4 hover:opacity-80">
                  <span className="font-medium leading-snug">{e.prompt}</span>
                  <span className={`text-right text-[14px] ${e.won ? "font-medium text-accent-ink" : "text-muted"}`}>
                    {e.won ? `Won ${e.prize} ${e.currency}` : e.status === "open" ? "Draw pending" : e.status === "expired" ? "No draw" : "Not drawn"}
                  </span>
                  <span className="text-[13px] text-muted">
                    You said &ldquo;{e.answer}&rdquo;, {ago(e.captured_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value, hint, wide }: { label: string; value: number | string; hint?: string; wide?: boolean }) {
  return (
    <div className={`rounded-[16px] bg-surface p-4 ring-1 ring-line ${wide ? "col-span-2 sm:col-span-1" : ""}`}>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</dd>
      {hint && <dd className="mt-0.5 text-[12px] text-muted">{hint}</dd>}
    </div>
  );
}
