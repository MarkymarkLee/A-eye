"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, SealCheck, Trophy } from "@phosphor-icons/react";
import { ago } from "@/lib/time";
import { PushOptIn } from "./push-opt-in";

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
  const [me, setMe] = useState<{ observer: Observer; entries: Entry[]; xrpl?: Xrpl } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState("");
  const [xrplAddress, setXrplAddress] = useState("");
  const [rail, setRail] = useState<"evm" | "xrpl">("evm");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
    setMsg(null);
    const res = await fetch("/api/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: name, evm_address: wallet.trim(), xrpl_address: xrplAddress.trim(), payout_rail: rail }),
    });
    const j = await res.json();
    setSaving(false);
    if (res.ok) setMe((m) => (m ? { ...m, observer: j.observer, xrpl: j.xrpl } : m));
    setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: j.error });
  }

  const wins = me?.entries.filter((e) => e.won) ?? [];

  return (
    <main className="mx-auto grid max-w-[1100px] gap-12 px-4 pb-24 pt-8 md:grid-cols-[5fr_7fr] md:px-6 md:pt-12">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Your observer profile</h1>
        <p className="mt-2 max-w-[44ch] text-[15px] leading-relaxed text-muted">
          For now your identity is this browser. Raffle winnings go to the wallet below.
        </p>

        {loadError ? (
          <p className="mt-8 text-[14px] text-bad">Couldn&apos;t load your profile. Refresh to try again.</p>
        ) : !me ? (
          <div className="mt-8 space-y-4" aria-label="Loading profile">
            <div className="h-11 animate-pulse rounded-[12px] bg-surface-2" />
            <div className="h-11 animate-pulse rounded-[12px] bg-surface-2" />
          </div>
        ) : (
          <form onSubmit={save} className="mt-8 grid gap-5">
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
            <div className="grid gap-2">
              <label htmlFor="xrpl" className="text-[14px] font-medium">
                XRPL address (testnet)
              </label>
              <input
                id="xrpl"
                value={xrplAddress}
                onChange={(e) => setXrplAddress(e.target.value)}
                className="field font-mono text-[14px]"
                placeholder="r..."
                spellCheck={false}
                autoCapitalize="off"
                aria-describedby="xrpl-help"
              />
              <p id="xrpl-help" className="text-[13px] text-muted">
                A classic r-address. Earns the Verified Observer credential after {me.xrpl?.threshold ?? 3} answers.
              </p>
            </div>
            <fieldset className="grid gap-2">
              <legend className="text-[14px] font-medium">Get paid on</legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["evm", "Base Sepolia (AUSD)"],
                    ["xrpl", "XRPL testnet (XRP escrow)"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[14px] ${rail === value ? "border-ink bg-ink text-bg" : "border-line hover:border-ink"}`}
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
                <p className="text-[13px] text-muted">XRPL payouts aren&apos;t switched on for this server yet; AUSD is used instead.</p>
              )}
            </fieldset>
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
        {me?.xrpl && <CredentialBadge xrpl={me.xrpl} hasAddress={Boolean(me.observer.xrpl_address)} />}

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

function CredentialBadge({ xrpl, hasAddress }: { xrpl: Xrpl; hasAddress: boolean }) {
  const issued = xrpl.credential?.state === "issued";
  const progress = Math.min(xrpl.accepted, xrpl.threshold);
  return (
    <div className={`mt-8 rounded-[16px] border px-4 py-4 ${issued ? "border-accent-ink/40 bg-surface-2" : "border-dashed border-line"}`}>
      <p className={`inline-flex items-center gap-2 text-[15px] font-medium ${issued ? "text-accent-ink" : ""}`}>
        <SealCheck size={20} weight={issued ? "fill" : "regular"} /> A-eye Verified Observer
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        {issued
          ? "Issued as an XRPL credential to your address."
          : xrpl.credential?.state === "pending"
            ? "Issuing on XRPL testnet now."
            : !xrpl.enabled
              ? "XRPL credentials aren't switched on for this server yet."
              : !hasAddress
                ? "Add an XRPL address to receive this credential."
                : `${progress} of ${xrpl.threshold} accepted answers.`}
      </p>
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
    </div>
  );
}
