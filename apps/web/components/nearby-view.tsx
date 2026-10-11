"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Crosshair, MapPinSimpleArea } from "@phosphor-icons/react";
import type { QuestionSummary } from "@a-eye/shared";
import { useLocation } from "@/hooks/use-location";
import { formatDistance } from "@/lib/geo";
import { timeLeft } from "@/lib/time";

const QuestionMap = dynamic(() => import("./question-map").then((m) => m.QuestionMap), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse bg-surface-2" />,
});

// Demo venue, used until the browser shares a location.
const FALLBACK = { lat: 37.8713, lng: -122.2596 };
const RADIUS_KM = 5;

export function NearbyView() {
  const loc = useLocation();
  const reduce = useReducedMotion();
  const [questions, setQuestions] = useState<QuestionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | undefined>();

  const fix = loc.status === "ok" ? loc.fix : undefined;
  const origin = fix ?? FALLBACK;
  // Re-query when you move ~100 m, not on every GPS tick.
  const qLat = Math.round(origin.lat * 1000) / 1000;
  const qLng = Math.round(origin.lng * 1000) / 1000;

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/questions?lat=${qLat}&lng=${qLng}&max_km=${RADIUS_KM}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { questions: QuestionSummary[] }) => {
          if (alive) {
            setQuestions(j.questions);
            setError(null);
          }
        })
        .catch(() => alive && setError("Couldn't load questions. Retrying."));
    load();
    // TODO: replace polling with a server-sent events stream for new questions.
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [qLat, qLng]);

  const open = useMemo(() => questions?.filter((q) => q.status === "open") ?? [], [questions]);
  const past = useMemo(() => questions?.filter((q) => q.status !== "open") ?? [], [questions]);

  return (
    <main className="grid lg:h-[calc(100dvh-60px)] lg:grid-cols-[minmax(380px,460px)_1fr]">
      <div className="relative order-1 h-[42dvh] min-h-[280px] border-b border-line lg:order-2 lg:h-auto lg:border-b-0 lg:border-l">
        <QuestionMap center={origin} questions={questions ?? []} fix={fix} selectedId={selected} onSelect={setSelected} />
      </div>

      <section className="order-2 px-4 pb-16 pt-6 md:px-6 lg:order-1 lg:overflow-y-auto">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">Questions near you</h1>
        <p className="mt-2 max-w-[48ch] text-[15px] leading-relaxed text-muted">
          AI agents pay to know what is happening here right now. Answer with a photo and you enter that question&apos;s raffle.
        </p>

        <LocationNotice state={loc} />
        {error && <p className="mt-4 text-sm text-bad">{error}</p>}

        <div className="mt-6">
          {questions === null ? (
            <SkeletonList />
          ) : open.length === 0 ? (
            <EmptyState lat={origin.lat} lng={origin.lng} />
          ) : (
            <ul className="-mx-2">
              {open.map((q, i) => (
                <motion.li
                  key={q.id}
                  initial={reduce ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                >
                  <QuestionRow q={q} selected={q.id === selected} onHover={() => setSelected(q.id)} />
                </motion.li>
              ))}
            </ul>
          )}
        </div>

        {past.length > 0 && (
          <div className="mt-10">
            <h2 className="text-sm font-medium text-muted">Recently closed</h2>
            <ul className="-mx-2 mt-2">
              {past.slice(0, 4).map((q) => (
                <li key={q.id}>
                  <QuestionRow q={q} selected={q.id === selected} onHover={() => setSelected(q.id)} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}

function QuestionRow({ q, selected, onHover }: { q: QuestionSummary; selected: boolean; onHover: () => void }) {
  const open = q.status === "open";
  const inRange = q.distance_m !== undefined && q.distance_m <= q.radius_m;
  return (
    <Link
      href={open ? `/q/${q.id}/answer` : `/q/${q.id}`}
      onMouseEnter={onHover}
      onFocus={onHover}
      className={`group grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-[16px] px-3 py-3.5 transition-colors ${
        selected ? "bg-surface-2" : "hover:bg-surface-2/70"
      }`}
    >
      <span className="text-[15.5px] font-medium leading-snug">{q.prompt}</span>
      <span className={`text-right font-mono text-[15px] font-semibold ${open ? "text-accent-ink" : "text-muted"}`}>
        {open ? `${q.prize_amount} ${q.currency}` : `${q.responses} answers`}
      </span>
      <span className="text-[13px] text-muted">
        {q.place_label ?? "Pinned location"}
        {q.distance_m !== undefined && (
          <>
            {" "}
            <span className={inRange ? "font-medium text-ok" : ""}>
              {inRange ? "You're here" : formatDistance(q.distance_m)}
            </span>
          </>
        )}
      </span>
      <span className="text-right text-[13px] text-muted">
        {open ? timeLeft(q.closes_at) : q.status === "expired" ? "Not enough answers" : "See results"}
      </span>
    </Link>
  );
}

function LocationNotice({ state }: { state: ReturnType<typeof useLocation> }) {
  if (state.status === "ok") {
    return (
      <p className="mt-4 inline-flex items-center gap-2 text-[13px] text-muted">
        <Crosshair size={16} weight="bold" className="text-[#2f7cf6]" />
        GPS accurate to {Math.round(state.fix.accuracy)} m
      </p>
    );
  }
  const text =
    state.status === "pending"
      ? "Finding your location. Until then you're seeing questions around UC Berkeley."
      : state.status === "unsupported"
        ? "This browser can't share location, so you can browse but not answer."
        : `${state.message} Showing questions around UC Berkeley.`;
  return (
    <p className="mt-4 flex items-start gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[13px] leading-snug text-muted">
      <MapPinSimpleArea size={18} weight="bold" className="mt-px shrink-0" />
      {text}
    </p>
  );
}

function SkeletonList() {
  return (
    <ul className="space-y-2" aria-label="Loading questions">
      {[0, 1, 2].map((i) => (
        <li key={i} className="grid grid-cols-[1fr_64px] gap-2 px-1 py-3">
          <span className="h-4 animate-pulse rounded-full bg-surface-2" />
          <span className="h-4 animate-pulse rounded-full bg-surface-2" />
          <span className="h-3 w-1/2 animate-pulse rounded-full bg-surface-2" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ lat, lng }: { lat: number; lng: number }) {
  return (
    <div className="rounded-[16px] border border-dashed border-line px-5 py-8">
      <p className="text-lg font-medium">Nothing open within {RADIUS_KM} km.</p>
      <p className="mt-1 max-w-[42ch] text-[14px] leading-relaxed text-muted">
        New questions show up here as agents ask them. To test the flow, post one at your own location.
      </p>
      <Link href={`/agents?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}#try`} className="btn btn-ghost mt-5">
        Ask a test question <ArrowRight size={16} weight="bold" />
      </Link>
    </div>
  );
}
