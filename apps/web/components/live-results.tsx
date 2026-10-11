"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, CheckCircle, Copy, Trophy, XCircle } from "@phosphor-icons/react";
import type { QuestionResults } from "@a-eye/shared";
import { formatDistance } from "@/lib/geo";
import { ago, clockTime, timeLeft } from "@/lib/time";
import { TallyBars } from "./tally-bars";

export function LiveResults({ initial, dev }: { initial: QuestionResults; dev: boolean }) {
  const [r, setR] = useState(initial);
  const [closing, setClosing] = useState(false);
  const reduce = useReducedMotion();
  const open = r.status === "open";

  useEffect(() => {
    if (!open) return;
    // TODO: swap polling for server-sent events once the API pushes updates.
    const t = setInterval(async () => {
      const res = await fetch(`/api/questions/${r.id}`, { cache: "no-store" });
      if (res.ok) setR(await res.json());
    }, 4000);
    return () => clearInterval(t);
  }, [open, r.id]);

  async function forceClose() {
    setClosing(true);
    await fetch(`/api/questions/${r.id}/close`, { method: "POST" });
    const res = await fetch(`/api/questions/${r.id}`, { cache: "no-store" });
    if (res.ok) setR(await res.json());
    setClosing(false);
  }

  const statusText =
    r.status === "open"
      ? `Open, ${timeLeft(r.closes_at)}`
      : r.status === "expired"
        ? `Closed with ${r.responses} of ${r.min_responses} needed answers`
        : `Closed ${clockTime(r.closes_at)}`;

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-24 pt-6 md:px-6 md:pt-10">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
        <section className="lg:sticky lg:top-[84px] lg:self-start">
          <p className="text-sm text-muted">
            {r.place_label ?? "Pinned location"}, within {formatDistance(r.radius_m)}
          </p>
          <h1 className="mt-2 text-[30px] font-semibold leading-[1.12] tracking-tight md:text-[42px]">{r.prompt}</h1>
          <p className="mt-3 flex items-center gap-2 text-[14px]">
            <span className={open ? "font-medium text-accent-ink" : "text-muted"}>{statusText}</span>
            <span className="text-muted">
              {r.responses} verified {r.responses === 1 ? "answer" : "answers"}
            </span>
          </p>

          <div className="mt-8">
            {r.responses > 0 ? (
              <TallyBars rows={r.tally} />
            ) : (
              <p className="text-[15px] leading-relaxed text-muted">No answers yet. The split appears here as people on site respond.</p>
            )}
          </div>

          {r.web_baseline && (
            <div className="mt-8 grid grid-cols-2 gap-4 rounded-[16px] bg-surface-2 p-4">
              <div>
                <p className="text-[13px] text-muted">The web says</p>
                <p className="mt-1 text-[15px] leading-snug">{r.web_baseline.answer}</p>
                <p className="mt-1 text-[12px] text-muted">{r.web_baseline.source}</p>
              </div>
              <div>
                <p className="text-[13px] text-muted">People there say</p>
                <p className="mt-1 text-[15px] font-medium leading-snug">
                  {r.responses ? leader(r) : "Waiting for answers"}
                </p>
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-2">
            {open && (
              <Link href={`/q/${r.id}/answer`} className="btn btn-primary">
                Answer this <ArrowRight size={16} weight="bold" />
              </Link>
            )}
            {open && dev && (
              <button type="button" onClick={forceClose} disabled={closing} className="btn btn-ghost">
                {closing ? "Drawing" : "Close and draw now"}
              </button>
            )}
          </div>

          <RafflePanel r={r} />
        </section>

        <section aria-label="Photo evidence">
          {r.evidence.length === 0 ? (
            <div className="flex aspect-[4/3] flex-col items-center justify-center rounded-[16px] border border-dashed border-line px-8 text-center">
              <p className="text-lg font-medium">Photos land here.</p>
              <p className="mt-1 max-w-[40ch] text-[14px] leading-relaxed text-muted">
                Every answer comes with a live photo, its distance from the spot and the time it was taken.
              </p>
            </div>
          ) : (
            <div className="columns-1 gap-4 sm:columns-2 [&>*]:mb-6">
              {r.evidence
                .slice()
                .reverse()
                .map((e, i) => (
                  <motion.figure
                    key={e.id}
                    className="break-inside-avoid"
                    initial={reduce ? false : { opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: Math.min(i, 6) * 0.05, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={e.image_url}
                      alt={`Photo answering "${e.answer}", taken ${formatDistance(e.distance_m)} from the spot`}
                      loading="lazy"
                      className={`w-full rounded-[12px] bg-surface-2 object-cover ${i % 3 === 1 ? "aspect-square" : "aspect-[4/5]"}`}
                    />
                    <figcaption className="mt-2.5">
                      <p className="flex items-center justify-between gap-3">
                        <span className="text-[15px] font-medium">{e.answer}</span>
                        <span className="font-mono text-[12px] text-muted">{formatDistance(e.distance_m)} away</span>
                      </p>
                      {e.free_text && <p className="mt-0.5 text-[14px] leading-snug text-muted">&ldquo;{e.free_text}&rdquo;</p>}
                      <p className="mt-1 text-[12.5px] text-muted">
                        {e.observer}, {ago(e.captured_at)}
                      </p>
                      {r.raffle.winner_submission_id === e.id && (
                        <p className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-ink">
                          <Trophy size={15} weight="fill" /> Raffle winner
                        </p>
                      )}
                    </figcaption>
                  </motion.figure>
                ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function leader(r: QuestionResults) {
  const top = [...r.tally].sort((a, b) => b.count - a.count)[0]!;
  return `${top.option} (${top.pct}%)`;
}

const short = (h: string) => (h.length > 20 ? `${h.slice(0, 10)}...${h.slice(-6)}` : h);

function RafflePanel({ r }: { r: QuestionResults }) {
  const [verdict, setVerdict] = useState<"idle" | "ok" | "bad">("idle");
  const settled = Boolean(r.raffle.seed_reveal);

  async function verify() {
    const seed = r.raffle.seed_reveal!;
    const commitOk = (await sha256(seed)) === r.raffle.seed_commit;
    const ids = r.evidence.map((e) => e.id).sort();
    const digest = await sha256(`${seed}${r.raffle.entropy_block_hash}${r.id}`);
    const idx = Number(BigInt(`0x${digest}`) % BigInt(ids.length));
    setVerdict(commitOk && ids[idx] === r.raffle.winner_submission_id ? "ok" : "bad");
  }

  return (
    <div className="mt-10 border-t border-line pt-6">
      <h2 className="text-[17px] font-semibold tracking-tight">Raffle</h2>
      <p className="mt-1 max-w-[52ch] text-[14px] leading-relaxed text-muted">
        {settled
          ? r.raffle.winner_observer
            ? `${r.raffle.winner_observer} wins ${r.raffle.prize_amount} ${r.raffle.currency}.`
            : "No winner was drawn."
          : r.status === "expired"
            ? "Too few answers, so there's no draw and the agent gets refunded."
            : `One verified answer wins ${r.raffle.prize_amount} ${r.raffle.currency}. The seed is committed now and revealed at close.`}
      </p>
      <dl className="mt-4 grid gap-3 font-mono text-[12.5px]">
        <Row label="Seed commit" value={r.raffle.seed_commit} />
        {settled && <Row label="Seed reveal" value={r.raffle.seed_reveal!} />}
        {settled && (
          <Row
            label="Block hash"
            value={r.raffle.entropy_block_hash!}
            href={r.raffle.entropy_block_number ? `https://sepolia.basescan.org/block/${r.raffle.entropy_block_number}` : undefined}
          />
        )}
        {settled &&
          (r.raffle.payout_tx ? (
            <Row label="AUSD payout" value={r.raffle.payout_tx} href={r.raffle.payout_url} />
          ) : (
            !r.raffle.xrpl?.payout_tx && <Row label="Payout" value="Pending" plain />
          ))}
        {r.raffle.xrpl && <XrplRows pot={r.raffle.xrpl} />}
      </dl>
      {settled && r.raffle.winner_submission_id && (
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={verify} className="btn btn-ghost !py-2 text-[13px]">
            Verify the draw
          </button>
          {verdict === "ok" && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-ok">
              <CheckCircle size={16} weight="fill" /> Commit and winner match
            </span>
          )}
          {verdict === "bad" && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-bad">
              <XCircle size={16} weight="fill" /> Mismatch
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function XrplRows({ pot }: { pot: NonNullable<QuestionResults["raffle"]["xrpl"]> }) {
  const status =
    pot.state === "canceled" ? "refunded" : pot.state === "finished" ? "released" : pot.state === "settling" ? "releasing" : "locked";
  return (
    <>
      <div className="grid grid-cols-[96px_1fr] items-center gap-3 pt-1">
        <dt className="font-sans text-[13px] text-muted">XRPL pot</dt>
        <dd className="font-sans text-[13px]">
          {pot.amount_xrp} XRP in escrow, {status}
        </dd>
      </div>
      <Row label="Escrow" value={pot.escrow_tx} href={pot.escrow_url} />
      {pot.finish_tx && <Row label="Finish" value={pot.finish_tx} href={pot.finish_url} />}
      {pot.cancel_tx && <Row label="Cancel" value={pot.cancel_tx} href={pot.cancel_url} />}
      {pot.payout_tx && <Row label="XRP payout" value={pot.payout_tx} href={pot.payout_url} />}
    </>
  );
}

function Row({ label, value, href, plain }: { label: string; value: string; href?: string; plain?: boolean }) {
  return (
    <div className="grid grid-cols-[96px_1fr_auto] items-center gap-3">
      <dt className="font-sans text-[13px] text-muted">{label}</dt>
      <dd className={`truncate ${plain ? "font-sans text-[13px] text-muted" : ""}`} title={value}>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:decoration-ink">
            {short(value)}
          </a>
        ) : plain ? (
          value
        ) : (
          short(value)
        )}
      </dd>
      {!plain && (
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(value)}
          className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
          aria-label={`Copy ${label}`}
        >
          <Copy size={14} />
        </button>
      )}
    </div>
  );
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
