"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Camera, Coins, Eye, Lock as LockSimple, Bot as Robot, Trophy, Undo2 as ArrowUUpLeft } from "lucide-react";
import type { ActivityEvent, ActivityResponse } from "@/lib/activity-types";
import { formatDistance } from "@/lib/geo";
import { ago, timeLeft } from "@/lib/time";
import type { MarketComparison } from "@a-eye/shared";
import { MarketsPanel } from "./markets-panel";

const POLL_MS = 3000;
// Photos carry the phone's capture time, which can trail the server clock, so each poll overlaps the last.
const OVERLAP_MS = 3 * 60_000;
const MAX_EVENTS = 120;
const RANK: Record<ActivityEvent["type"], number> = { question_asked: 0, photo: 1, peek: 2, question_closed: 3, raffle_reveal: 4, payout: 5 };

const order = (a: ActivityEvent, b: ActivityEvent) => Date.parse(b.at) - Date.parse(a.at) || RANK[b.type] - RANK[a.type];

function merge(prev: ActivityEvent[], next: ActivityEvent[]) {
  const byId = new Map(prev.map((e) => [e.id, e]));
  for (const e of next) byId.set(e.id, e);
  return [...byId.values()].sort(order).slice(0, MAX_EVENTS);
}

const txUrl = (tx: string) => `https://sepolia.basescan.org/tx/${tx}`;
const short = (h: string) => (h.length > 18 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);
const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function LiveDashboard({
  initial,
  initialMarkets,
  qrSvg,
  target,
}: {
  initial: ActivityResponse;
  initialMarkets: MarketComparison[];
  qrSvg: string;
  target: string;
}) {
  const [data, setData] = useState(initial);
  const [events, setEvents] = useState(() => [...initial.events].sort(order));
  const [now, setNow] = useState(() => Date.parse(initial.now));
  const [stale, setStale] = useState(false);
  const serverNow = useRef(initial.now);
  const firstIds = useRef(new Set(initial.events.map((e) => e.id)));

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const since = new Date(Date.parse(serverNow.current) - OVERLAP_MS).toISOString();
        const res = await fetch(`/api/activity?since=${encodeURIComponent(since)}&limit=200`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as ActivityResponse;
        if (stop) return;
        serverNow.current = next.now;
        setData(next);
        setEvents((prev) => merge(prev, next.events));
        setStale(false);
      } catch {
        if (!stop) setStale(true);
      }
    };
    const t = setInterval(poll, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(t);
      clearInterval(clock);
    };
  }, []);

  const c = data.counters;
  const photos = events.filter((e): e is Extract<ActivityEvent, { type: "photo" }> => e.type === "photo").slice(0, 9);
  const host = target.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <main className="mx-auto max-w-[1880px] px-4 pb-12 pt-6 md:px-8 md:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="relative flex size-2.5">
              {!stale && <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />}
              <span className={`relative inline-flex size-2.5 rounded-full ${stale ? "bg-muted" : "bg-accent"}`} />
            </span>
            {stale ? "Reconnecting" : "Live"} · Chou Hall, UC Berkeley
          </p>
          <h1 className="mt-1 text-[34px] font-semibold leading-tight tracking-tight md:text-[44px]">Agents asking. Humans answering.</h1>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Counter label="Questions asked" value={c.questions} sub={`${c.open_questions} open now`} />
        <Counter label="Verified photos" value={c.verified_photos} sub="GPS, timing and hash checked" />
        <Counter label="Unique observers" value={c.unique_observers} sub="people who answered" />
        <Counter
          label="AUSD paid to humans"
          value={money(c.ausd_paid)}
          sub={`${money(c.ausd_bounties)} AUSD bounties · ${money(c.ausd_peeks ?? 0)} AUSD peeks · ${c.onchain_txs} on-chain tx`}
          accent
        />
      </dl>

      <MarketsPanel initial={initialMarkets} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)_minmax(0,0.8fr)]">
        <aside className="space-y-6">
          <section className="rounded-[16px] bg-surface p-5 shadow-panel ring-1 ring-line">
            <h2 className="text-[17px] font-semibold tracking-tight">Scan to answer</h2>
            <p className="mt-1 text-[14px] leading-snug text-muted">Open the camera, answer a question nearby, enter the raffle.</p>
            <div
              className="mt-4 rounded-[12px] bg-white p-4 [&>svg]:h-auto [&>svg]:w-full"
              role="img"
              aria-label={`QR code for ${host}`}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="mt-3 break-all text-center font-mono text-[13px] text-muted">{host}</p>
          </section>

          <section>
            <h2 className="text-[15px] font-semibold tracking-tight">Open now</h2>
            {data.open.length === 0 ? (
              <p className="mt-2 text-[14px] text-muted">No open questions. The next agent question appears here.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {data.open.map((q) => (
                  <li key={q.id} className="py-3">
                    <Link href={`/q/${q.id}`} className="text-[15px] font-medium leading-snug hover:underline">
                      {q.prompt}
                    </Link>
                    <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[12.5px] text-muted">
                      <span>
                        {q.responses}/{q.max_responses} answers
                      </span>
                      <span>{timeLeft(q.closes_at, now)}</span>
                      <span>
                        {money(q.prize_amount)} {q.currency}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        <section aria-label="Activity feed" aria-live="polite">
          <h2 className="text-[15px] font-semibold tracking-tight">Activity</h2>
          {events.length === 0 ? (
            <p className="mt-2 text-[14px] text-muted">Nothing yet. Ask a question from an agent to start the feed.</p>
          ) : (
            <ol className="mt-2 space-y-2.5">
              <AnimatePresence initial={false}>
                {events.map((e) => (
                  <FeedItem key={e.id} e={e} now={now} fresh={!firstIds.current.has(e.id)} />
                ))}
              </AnimatePresence>
            </ol>
          )}
        </section>

        <section aria-label="Latest photos" className="hidden xl:block">
          <h2 className="text-[15px] font-semibold tracking-tight">Latest photos</h2>
          {photos.length === 0 ? (
            <p className="mt-2 text-[14px] text-muted">Photos appear here as they are verified.</p>
          ) : (
            <div className="mt-2 grid grid-cols-3 gap-2.5">
              {photos.map((p, i) => (
                <Link
                  key={p.id}
                  href={`/q/${p.question_id}`}
                  className={`group relative overflow-hidden rounded-[12px] bg-surface-2 ${i === 0 ? "col-span-2 row-span-2" : ""}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb_url} alt={p.sealed ? "Photo answer, hidden until close" : `Photo answering "${p.answer}"`} className="aspect-square size-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-6 text-left text-white">
                    <span className="block truncate text-[13px] font-medium">{p.sealed ? "Answer hidden until close" : p.answer}</span>
                    <span className="block font-mono text-[11px] opacity-80">{formatDistance(p.distance_m)} away</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Counter({ label, value, sub, accent }: { label: string; value: number | string; sub: string; accent?: boolean }) {
  return (
    <div className="rounded-[16px] bg-surface p-4 shadow-panel ring-1 ring-line md:p-5">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-[40px] font-semibold leading-none tracking-tight md:text-[56px] ${accent ? "text-accent-ink" : ""}`}>
        {value}
      </dd>
      <p className="mt-2 truncate text-[12.5px] text-muted">{sub}</p>
    </div>
  );
}

const ICON = {
  question_asked: Robot,
  photo: Camera,
  peek: Eye,
  question_closed: LockSimple,
  raffle_reveal: Trophy,
  payout: Coins,
} as const;

const LABEL: Record<ActivityEvent["type"], string> = {
  question_asked: "Agent asked",
  photo: "Photo answer",
  peek: "Paid peek",
  question_closed: "Question closed",
  raffle_reveal: "Raffle drawn",
  payout: "Payout",
};

function FeedItem({ e, now, fresh }: { e: ActivityEvent; now: number; fresh: boolean }) {
  const reduce = useReducedMotion();
  const Icon = e.type === "payout" && e.kind === "refund" ? ArrowUUpLeft : ICON[e.type];
  const highlight = e.type === "payout" || e.type === "raffle_reveal";
  return (
    <motion.li
      layout={!reduce}
      initial={fresh && !reduce ? { opacity: 0, y: -12, scale: 0.98 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={`grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 rounded-[16px] p-3.5 ring-1 ${
        highlight ? "bg-surface ring-accent/40" : "bg-surface ring-line"
      }`}
    >
      <span
        className={`mt-0.5 grid size-9 place-items-center rounded-full ${highlight ? "bg-accent text-on-accent" : "bg-surface-2 text-ink"}`}
        aria-hidden
      >
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-[12.5px] text-muted">
          {e.type === "payout" && e.kind === "refund" ? "Refund" : LABEL[e.type]}
          {e.place_label ? ` · ${e.place_label}` : ""}
        </p>
        <Body e={e} />
      </div>
      <time dateTime={e.at} className="whitespace-nowrap font-mono text-[12px] text-muted">
        {ago(e.at, now)}
      </time>
    </motion.li>
  );
}

function Tx({ tx, label }: { tx: string; label?: string }) {
  return (
    <a href={txUrl(tx)} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] text-accent-ink underline decoration-accent/40 underline-offset-4 hover:decoration-accent">
      {label ?? "tx"} {short(tx)}
    </a>
  );
}

function Body({ e }: { e: ActivityEvent }) {
  const q = (
    <Link href={`/q/${e.question_id}`} className="hover:underline">
      {e.prompt}
    </Link>
  );
  switch (e.type) {
    case "question_asked":
      return (
        <>
          <p className="mt-0.5 text-[16px] font-medium leading-snug">{q}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            <span>
              {money(e.prize_amount)} {e.currency} raffle
            </span>
            {e.market_label && <span>Market: {e.market_label}</span>}
            {e.payment_tx ? <Tx tx={e.payment_tx} label="x402 paid" /> : <span>unpaid (dev)</span>}
          </p>
        </>
      );
    case "photo":
      return (
        <div className="mt-1 flex gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={e.thumb_url} alt="" className="size-14 shrink-0 rounded-[12px] bg-surface-2 object-cover" loading="lazy" />
          <div className="min-w-0">
            <p className="text-[16px] font-medium leading-snug">
              {e.sealed ? (
                <>
                  {e.observer} answered <span className="text-muted">· hidden until close</span>
                </>
              ) : (
                <>
                  {e.observer} says &ldquo;{e.answer}&rdquo;
                </>
              )}
            </p>
            <p className="mt-0.5 truncate text-[13px] text-muted">
              <span className="font-mono">{formatDistance(e.distance_m)} away</span> · {e.prompt}
            </p>
          </div>
        </div>
      );
    case "peek":
      return (
        <>
          <p className="mt-0.5 text-[16px] font-medium leading-snug">
            {e.payer_address ? `Agent ${short(e.payer_address)}` : "An agent"} paid {money(e.amount)} {e.currency} for an early look
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            <span>
              at {e.responses_at_peek} {e.responses_at_peek === 1 ? "answer" : "answers"} · tops up the raffle
            </span>
            <Tx tx={e.tx} label="x402 paid" />
          </p>
          <p className="mt-0.5 truncate text-[13px] text-muted">{q}</p>
        </>
      );
    case "question_closed":
      return (
        <>
          <p className="mt-0.5 text-[16px] font-medium leading-snug">
            {e.status === "expired"
              ? `Too few answers (${e.responses} of ${e.min_responses})`
              : e.leader
                ? `${e.leader.pct}% ${e.leader.option} (${e.responses} ${e.responses === 1 ? "human" : "humans"})`
                : "Closed"}
          </p>
          <p className="mt-0.5 truncate text-[13px] text-muted">{q}</p>
          {e.status === "settled" && e.tally.length > 0 && (
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-2">
              {e.tally.map((t) => (
                <span
                  key={t.option}
                  style={{ width: `${t.pct}%` }}
                  className={t.option === e.leader?.option ? "bg-accent" : "bg-muted/40"}
                />
              ))}
            </div>
          )}
        </>
      );
    case "raffle_reveal":
      return (
        <>
          <p className="mt-0.5 text-[16px] font-medium leading-snug">
            {e.winner_observer ? `${e.winner_observer} wins` : "No winner"} · 1 of {e.entrants}
          </p>
          <p className="mt-1 grid gap-0.5 font-mono text-[12px] text-muted">
            <span>seed {short(e.seed_reveal)}</span>
            <span>
              block{" "}
              {e.entropy_block_number ? (
                <a href={`https://sepolia.basescan.org/block/${e.entropy_block_number}`} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4">
                  #{e.entropy_block_number} {short(e.entropy_block_hash)}
                </a>
              ) : (
                short(e.entropy_block_hash)
              )}
            </span>
          </p>
          <p className="mt-1 truncate text-[13px] text-muted">
            <Link href={`/q/${e.question_id}#raffle`} className="hover:underline">
              Verify it yourself →
            </Link>
          </p>
        </>
      );
    case "payout":
      return (
        <>
          <p className="mt-0.5 text-[16px] font-medium leading-snug">
            {money(e.amount)} {e.currency} → {e.to_label}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
            <Tx tx={e.tx} label="Base Sepolia" />
            <span className="truncate">{e.prompt}</span>
          </p>
        </>
      );
  }
}
