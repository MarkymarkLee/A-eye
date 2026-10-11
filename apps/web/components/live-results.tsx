"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { ArrowLeft, Camera, Check, CircleCheck, CircleX, Copy, Globe, ImageIcon, MapPin, ShieldCheck, Trophy, Users } from "lucide-react";
import type { Evidence, QuestionResults } from "@a-eye/shared";
import { marketVsHumans, webVsHumans } from "@/lib/compare";
import { formatDistance } from "@/lib/geo";
import { raffleSnippet } from "@/lib/raffle-snippet";
import { ago, clockTime } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Morph } from "./motion/page";
import { TallyBars } from "./tally-bars";
import { AnimatedNumber } from "./ui/animated-number";
import { Badge, LiveDot } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Countdown } from "./ui/countdown";
import { Disclosure } from "./ui/disclosure";
import { EmptyState } from "./ui/empty-state";
import { Sheet } from "./ui/sheet";

export function LiveResults({ initial, dev }: { initial: QuestionResults; dev: boolean }) {
  const [r, setR] = useState(initial);
  const [closing, setClosing] = useState(false);
  const [zoom, setZoom] = useState<Evidence | null>(null);
  const seen = useRef(initial.evidence.length);
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

  useEffect(() => {
    const n = r.evidence.length - seen.current;
    if (n > 0) toast(n === 1 ? "A new photo just came in" : `${n} new photos just came in`, { icon: <Camera className="size-4" /> });
    seen.current = r.evidence.length;
  }, [r.evidence.length]);

  async function forceClose() {
    setClosing(true);
    await fetch(`/api/questions/${r.id}/close`, { method: "POST" });
    const res = await fetch(`/api/questions/${r.id}`, { cache: "no-store" });
    if (res.ok) setR(await res.json());
    setClosing(false);
  }

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-24 pt-4 md:px-6 md:pt-8">
      <Link
        href="/"
        transitionTypes={["nav-back"]}
        className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-full px-2 text-[14px] font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden /> Nearby
      </Link>
      <div className="mt-2 grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
        <section className="lg:sticky lg:top-[84px] lg:self-start">
          <div className="flex flex-wrap items-center gap-2">
            {open ? (
              <Badge tone="accent" size="md">
                <LiveDot /> Live · <Countdown to={r.closes_at} icon={false} />
              </Badge>
            ) : r.status === "expired" ? (
              <Badge tone="warn" size="md">Closed early</Badge>
            ) : (
              <Badge size="md">Closed {clockTime(r.closes_at)}</Badge>
            )}
            <Badge size="md">
              <MapPin className="size-3.5" aria-hidden /> {r.place_label ?? "Pinned spot"}
            </Badge>
          </div>
          <Morph name={`q-${r.id}`}>
            <h1 className="mt-3 text-[30px] font-semibold leading-[1.12] tracking-tight text-balance md:text-[42px]">{r.prompt}</h1>
          </Morph>

          <Card className="mt-6 p-5">
            <p className="flex items-center gap-2 text-[14px] text-muted">
              <Users className="size-4" aria-hidden />
              <span>
                <AnimatedNumber value={r.responses} className="font-semibold text-ink tabular-nums" /> people on site answered
              </span>
            </p>
            <div className="mt-5">
              {r.responses > 0 ? (
                <TallyBars rows={r.tally} />
              ) : (
                <p className="text-[15px] leading-relaxed text-muted">No answers yet. The split appears here as people respond.</p>
              )}
            </div>
          </Card>

          <Comparison r={r} />

          {open && (
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild size="xl" className="flex-1 sm:flex-none">
                <Link href={`/q/${r.id}/answer`} transitionTypes={["nav-forward"]}>
                  <Camera className="size-5" aria-hidden /> Answer this
                </Link>
              </Button>
              {dev && (
                <Button variant="ghost" size="xl" onClick={forceClose} disabled={closing}>
                  {closing ? "Drawing…" : "Close and draw now"}
                </Button>
              )}
            </div>
          )}

          <Prize r={r} />
        </section>

        <section aria-label="Photos from people on site">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
            Photos · {r.evidence.length}
          </h2>
          {r.evidence.length === 0 ? (
            <EmptyState
              icon={<ImageIcon className="size-7" aria-hidden />}
              title="Photos land here"
              body="Every answer comes with a live photo, how far from the spot it was taken, and when."
              className="aspect-[4/3] justify-center"
            />
          ) : (
            <div className="columns-2 gap-3 md:gap-4 [&>*]:mb-3 md:[&>*]:mb-4">
              {r.evidence
                .slice()
                .reverse()
                .map((e, i) => (
                  <Photo key={e.id} e={e} i={i} winner={r.raffle.winner_submission_id === e.id} onOpen={() => setZoom(e)} />
                ))}
            </div>
          )}
        </section>
      </div>

      <Sheet open={Boolean(zoom)} onOpenChange={(o) => !o && setZoom(null)} title="Photo" description={zoom?.answer}>
        {zoom && (
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoom.image_url} alt={`Photo answering "${zoom.answer}"`} className="max-h-[62dvh] w-full rounded-[18px] object-contain" />
            <p className="mt-3 text-[17px] font-semibold">{zoom.answer}</p>
            {zoom.free_text && <p className="mt-1 text-[14.5px] text-muted">&ldquo;{zoom.free_text}&rdquo;</p>}
            <p className="mt-1 text-[13.5px] text-muted">
              {zoom.observer} · {formatDistance(zoom.distance_m)} from the spot · {ago(zoom.captured_at)}
            </p>
          </div>
        )}
      </Sheet>
    </main>
  );
}

function Photo({ e, i, winner, onOpen }: { e: Evidence; i: number; winner: boolean; onOpen: () => void }) {
  const reduce = useReducedMotion();
  const [loaded, setLoaded] = useState(false);
  return (
    <motion.figure
      className="break-inside-avoid"
      initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay: Math.min(i, 6) * 0.05, ease: [0.16, 1, 0.3, 1] }}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "relative block w-full overflow-hidden rounded-[18px] bg-surface-2",
          i % 3 === 1 ? "aspect-square" : "aspect-[4/5]",
          winner && "ring-[3px] ring-accent",
        )}
        aria-label={`Open photo: ${e.answer}`}
      >
        {!loaded && <span className="skeleton absolute inset-0" aria-hidden />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={e.image_url}
          alt={`Photo answering "${e.answer}", taken ${formatDistance(e.distance_m)} from the spot`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={cn("size-full object-cover transition-[opacity,transform] duration-500 hover:scale-[1.03]", loaded ? "opacity-100" : "opacity-0")}
        />
        <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-1 text-[11.5px] font-semibold text-white backdrop-blur">
          {formatDistance(e.distance_m)} away
        </span>
        {winner && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[12px] font-bold text-on-accent">
            <Trophy className="size-3.5" aria-hidden /> Winner
          </span>
        )}
      </button>
      <figcaption className="mt-2 px-0.5">
        <p className="text-[14.5px] font-semibold leading-snug">{e.answer}</p>
        {e.free_text && <p className="mt-0.5 line-clamp-2 text-[13.5px] leading-snug text-muted">&ldquo;{e.free_text}&rdquo;</p>}
        <p className="mt-0.5 text-[12.5px] text-muted">
          <span suppressHydrationWarning>{e.observer} · {ago(e.captured_at)}</span>
        </p>
      </figcaption>
    </motion.figure>
  );
}


const short = (h: string) => (h.length > 20 ? `${h.slice(0, 10)}...${h.slice(-6)}` : h);

/** Plain-language prize status, with the cryptographic proof tucked behind "How is this fair?". */
function Prize({ r }: { r: QuestionResults }) {
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

  const prize = `${r.raffle.prize_amount} ${r.raffle.currency}`;
  return (
    <div id="raffle" className="mt-8 grid scroll-mt-24 gap-3">
      <Card className={cn("flex items-start gap-3.5 p-5", settled && r.raffle.winner_observer && "bg-accent-soft ring-transparent")}>
        <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-accent to-accent-2 text-white">
          <Trophy className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-[16px] font-semibold tracking-tight">
            {settled
              ? r.raffle.winner_observer
                ? `${r.raffle.winner_observer} wins ${r.raffle.xrpl?.payout_tx ? `${r.raffle.xrpl.payout_amount ?? r.raffle.xrpl.amount_xrp} ${r.raffle.xrpl.payout_currency ?? "XRP"} on the XRP Ledger` : prize}`
                : "No winner was drawn"
              : r.status === "expired"
                ? "No draw this time"
                : `One person wins ${prize}`}
          </p>
          <p className="mt-0.5 text-[14px] leading-relaxed text-muted">
            {settled
              ? "Picked at random from everyone who answered."
              : r.status === "expired"
                ? `Only ${r.responses} of ${r.min_responses} needed answers came in, so the asker gets their money back.`
                : "Everyone with a verified photo gets one entry. The winner is picked at random when it closes."}
          </p>
        </div>
      </Card>

      <Disclosure title="How is this fair?" icon={<ShieldCheck className="size-5" aria-hidden />}>
        <p className="text-[14px] leading-relaxed text-muted">
          Before anyone answers, we lock in a secret number and publish its fingerprint below. At close we reveal it and mix it with a
          public blockchain value nobody controls, so the winner can&apos;t be chosen by hand. Anyone can re-check the math.
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
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="soft" size="sm" onClick={verify}>
              <ShieldCheck className="size-4" aria-hidden /> Check the draw myself
            </Button>
            {verdict === "ok" && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ok">
                <CircleCheck className="size-4" aria-hidden /> Everything matches
              </span>
            )}
            {verdict === "bad" && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-bad">
                <CircleX className="size-4" aria-hidden /> Mismatch
              </span>
            )}
          </div>
        )}
        {settled && r.raffle.winner_submission_id && <VerifySnippet r={r} />}
      </Disclosure>
    </div>
  );
}

function Comparison({ r }: { r: QuestionResults }) {
  const web = webVsHumans(r.web_baseline as Parameters<typeof webVsHumans>[0], r.tally);
  const market = marketVsHumans(r.market_ref, r.options, r.tally);
  if (!web && !market) return null;
  const humans = web?.humans ? `${web.humans.option} (${web.humans.pct}%)` : "Waiting for answers";
  return (
    <section aria-label="The internet and the market versus people there" className="mt-3 grid gap-3">
      {web && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[18px] bg-surface-2 p-4">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-muted">
              <Globe className="size-3.5" aria-hidden /> The internet
            </p>
            <p className="mt-1.5 text-[15px] leading-snug">{web.web_option ?? web.web}</p>
            {web.web_option && web.web_option !== web.web && <p className="mt-1 text-[13px] leading-snug text-muted">{web.web}</p>}
            <p className="mt-1 truncate text-[12px] text-muted">{web.source}</p>
          </div>
          <div className="rounded-[18px] bg-accent-soft p-4">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-accent-ink">
              <Camera className="size-3.5" aria-hidden /> People there
            </p>
            <p className="mt-1.5 text-[15px] font-semibold leading-snug">{humans}</p>
            {web.humans && (
              <p className="mt-1 text-[12px] text-muted">
                {r.responses} on-site {r.responses === 1 ? "photo" : "photos"}
              </p>
            )}
          </div>
        </div>
      )}
      {web?.agree !== undefined && (
        <p
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold",
            web.agree ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn",
          )}
        >
          {web.agree ? <CircleCheck className="size-4" aria-hidden /> : <CircleX className="size-4" aria-hidden />}
          {web.agree ? "The internet and the crowd agree" : "The crowd contradicts the internet"}
        </p>
      )}
      {market && (
        <div className="rounded-[18px] bg-surface p-4 ring-1 ring-line">
          <p className="text-[18px] font-semibold tabular-nums tracking-tight">
            Market {market.market_pct}% <span className="text-muted">·</span> People there{" "}
            {market.humans_pct === null ? "–" : `${market.humans_pct}%`}
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-muted">
            Chance of &ldquo;{market.yes_option}&rdquo;
            {market.label ? ` · ${market.label}` : ""} · {market.provider}
            {market.gap !== null && market.gap !== 0 && ` · crowd is ${Math.abs(market.gap)} pts ${market.gap > 0 ? "above" : "below"} the market`}
          </p>
        </div>
      )}
    </section>
  );
}

function VerifySnippet({ r }: { r: QuestionResults }) {
  const [copied, setCopied] = useState(false);
  const code = raffleSnippet({
    questionId: r.id,
    seedReveal: r.raffle.seed_reveal!,
    seedCommit: r.raffle.seed_commit,
    blockHash: r.raffle.entropy_block_hash!,
    submissionIds: r.evidence.map((e) => e.id),
  });
  return (
    <details className="group mt-4 rounded-[16px] bg-surface-2 p-4 open:pb-3">
      <summary className="cursor-pointer list-none rounded-[8px] text-[14px] font-semibold marker:hidden focus-visible:outline-2 focus-visible:outline-accent">
        Verify it yourself <span className="font-normal text-muted group-open:hidden">· show the code</span>
      </summary>
      <p className="mt-2 max-w-[60ch] text-[13px] leading-relaxed text-muted">
        Paste this into a browser console or <code className="font-mono">node</code>. It hashes the revealed seed, the block hash and the
        question id, then picks from the sorted submission ids, exactly like the server did.
      </p>
      <div className="relative mt-3">
        <pre className="max-h-[320px] overflow-auto rounded-[12px] bg-bg p-3 pr-11 font-mono text-[11.5px] leading-relaxed">
          <code>{code}</code>
        </pre>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard?.writeText(code);
            setCopied(true);
            toast.success("Code copied");
            setTimeout(() => setCopied(false), 1500);
          }}
          className="absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-surface text-muted ring-1 ring-line hover:text-ink"
          aria-label="Copy verification code"
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </button>
      </div>
      <p className="mt-2 break-all font-mono text-[12px] text-muted">
        Expected winner: {r.raffle.winner_submission_id}
        {r.raffle.winner_observer ? ` (${r.raffle.winner_observer})` : ""}
      </p>
    </details>
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
      {pot.settle_mode === "batch" && pot.batch_tx && (
        <>
          <div className="grid grid-cols-[96px_1fr] items-center gap-3">
            <dt className="font-sans text-[13px] text-muted">Settlement</dt>
            <dd className="font-sans text-[13px]">Settled atomically in one Batch</dd>
          </div>
          <Row label="Batch" value={pot.batch_tx} href={pot.batch_url} />
        </>
      )}
      {pot.finish_tx && <Row label="Finish" value={pot.finish_tx} href={pot.finish_url} />}
      {pot.cancel_tx && <Row label="Cancel" value={pot.cancel_tx} href={pot.cancel_url} />}
      {pot.payout_tx && (
        <Row label={`${pot.payout_currency ?? "XRP"} payout`} value={pot.payout_tx} href={pot.payout_url} />
      )}
      {pot.fee_tx && <Row label="Platform fee" value={pot.fee_tx} href={pot.fee_url} />}
    </>
  );
}

function Row({ label, value, href, plain }: { label: string; value: string; href?: string; plain?: boolean }) {
  return (
    <div className="grid grid-cols-[96px_1fr_auto] items-center gap-3">
      <dt className="font-sans text-[13px] text-muted">{label}</dt>
      <dd className={cn("truncate", plain && "font-sans text-[13px] text-muted")} title={value}>
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
          onClick={() => {
            navigator.clipboard?.writeText(value);
            toast.success(`${label} copied`);
          }}
          className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
          aria-label={`Copy ${label}`}
        >
          <Copy className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
