"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Camera, ChevronRight, Compass, LocateFixed, MapPinOff, Navigation, Sparkles, Users } from "lucide-react";
import type { QuestionSummary } from "@a-eye/shared";
import { useLocation, type LocationState } from "@/hooks/use-location";
import { haptic } from "@/lib/haptics";
import { walkHint, directionsUrl } from "@/lib/walk";
import { cn } from "@/lib/cn";
import { Morph } from "./motion/page";
import { InstallPrompt } from "./install-prompt";
import { PermissionHelp } from "./permission-help";
import { PushOptIn } from "./push-opt-in";
import { Badge, LiveDot } from "./ui/badge";
import { Button } from "./ui/button";
import { Countdown } from "./ui/countdown";
import { EmptyState } from "./ui/empty-state";
import { Sheet } from "./ui/sheet";
import { Skeleton } from "./ui/skeleton";

const QuestionMap = dynamic(() => import("./question-map").then((m) => m.QuestionMap), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

// Demo venue, used until the browser shares a location.
const FALLBACK = { lat: 37.8713, lng: -122.2596 };
const RADIUS_KM = 5;

export function NearbyView() {
  const loc = useLocation();
  const [questions, setQuestions] = useState<QuestionSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();
  const [preview, setPreview] = useState<string | null>(null);

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
            setError(false);
          }
        })
        .catch(() => alive && setError(true));
    load();
    // TODO: replace polling with a server-sent events stream for new questions.
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [qLat, qLng]);

  const open = useMemo(
    () => (questions ?? []).filter((q) => q.status === "open").sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0)),
    [questions],
  );
  const past = useMemo(() => questions?.filter((q) => q.status !== "open") ?? [], [questions]);
  const previewQ = questions?.find((q) => q.id === preview);
  const pot = open.reduce((s, q) => s + q.prize_amount, 0);

  return (
    <main className="grid lg:h-[calc(100dvh-60px)] lg:grid-cols-[minmax(400px,480px)_1fr]">
      <div className="relative order-1 h-[44dvh] min-h-[300px] lg:order-2 lg:h-auto">
        <QuestionMap
          center={origin}
          questions={questions ?? []}
          fix={fix}
          selectedId={selected}
          onSelect={(id) => {
            haptic("select");
            setSelected(id);
            setPreview(id);
          }}
        />
        {open.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-surface/90 px-3 py-1.5 text-[13px] font-semibold shadow-panel ring-1 ring-line backdrop-blur"
          >
            <LiveDot /> {open.length} open nearby
          </motion.div>
        )}
      </div>

      <section className="relative z-10 order-2 -mt-6 rounded-t-[28px] bg-bg px-4 pb-10 pt-6 md:px-6 lg:order-1 lg:mt-0 lg:overflow-y-auto lg:rounded-none lg:pt-8">
        <div aria-hidden className="mx-auto -mt-2 mb-4 h-1.5 w-11 rounded-full bg-surface-3 lg:hidden" />
        <h1 className="text-[30px] font-semibold leading-[1.1] tracking-tight text-balance md:text-4xl">
          Answer a question, <span className="text-gradient">win the prize.</span>
        </h1>
        <p className="mt-2 max-w-[46ch] text-[15.5px] leading-relaxed text-muted text-pretty">
          AI agents want to know what&apos;s happening here right now. Walk to a pin, snap a photo, and you&apos;re in the draw.
        </p>
        {pot > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="accent" size="md">
              <Sparkles className="size-3.5" aria-hidden /> {Math.round(pot * 100) / 100} {open[0]?.currency} up for grabs
            </Badge>
            <Badge size="md">
              <Camera className="size-3.5" aria-hidden /> ~20 sec per answer
            </Badge>
          </div>
        )}

        <LocationNotice state={loc} />
        <InstallPrompt />
        <PushOptIn fix={fix} />
        {error && (
          <p role="status" className="mt-4 rounded-[14px] bg-warn-soft px-3.5 py-2.5 text-[14px] text-warn">
            Connection hiccup. We&apos;ll keep trying.
          </p>
        )}

        <div className="mt-6">
          {questions === null ? (
            <SkeletonList />
          ) : open.length === 0 ? (
            <EmptyState
              icon={<Compass className="size-7" aria-hidden />}
              title="No open questions near you yet"
              body="New questions pop up here as agents ask them. Check back soon, or post a test question at your spot."
              action={
                <Button asChild variant="secondary">
                  <Link href={`/agents?lat=${origin.lat.toFixed(5)}&lng=${origin.lng.toFixed(5)}#try`}>
                    Ask a test question <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              }
            />
          ) : (
            <>
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Open now</h2>
              <List items={open} selected={selected} onHover={setSelected} />
            </>
          )}
        </div>

        {past.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Recently answered</h2>
            <List items={past.slice(0, 4)} selected={selected} onHover={setSelected} />
          </div>
        )}
      </section>

      <Sheet
        open={Boolean(previewQ)}
        onOpenChange={(o) => !o && setPreview(null)}
        title={previewQ?.prompt ?? "Question"}
        description="Question details"
      >
        {previewQ && <Preview q={previewQ} />}
      </Sheet>
    </main>
  );
}

function List({ items, selected, onHover }: { items: QuestionSummary[]; selected?: string; onHover: (id: string) => void }) {
  const reduce = useReducedMotion();
  return (
    <ul className="grid gap-2.5">
      {items.map((q, i) => (
        <motion.li
          key={q.id}
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
        >
          <QuestionCard q={q} selected={q.id === selected} onHover={() => onHover(q.id)} />
        </motion.li>
      ))}
    </ul>
  );
}

function QuestionCard({ q, selected, onHover }: { q: QuestionSummary; selected: boolean; onHover: () => void }) {
  const open = q.status === "open";
  const here = q.distance_m !== undefined && q.distance_m <= q.radius_m;
  return (
    <Link
      href={open ? `/q/${q.id}/answer` : `/q/${q.id}`}
      transitionTypes={["nav-forward"]}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={() => haptic("tap")}
      className={cn(
        "group flex items-center gap-3.5 rounded-[20px] bg-surface p-3 pr-4 shadow-panel ring-1 transition-[box-shadow,transform] duration-300 active:scale-[0.985]",
        selected ? "ring-accent/60" : "ring-line hover:ring-surface-3",
      )}
    >
      <span
        className={cn(
          "grid size-[60px] shrink-0 place-items-center rounded-[16px] text-center leading-none",
          open ? "bg-gradient-to-br from-accent to-accent-2 text-white" : "bg-surface-2 text-muted",
        )}
      >
        {open ? (
          <span>
            <span className="block text-[20px] font-bold tabular-nums">{q.prize_amount}</span>
            <span className="mt-0.5 block text-[10.5px] font-semibold opacity-90">{q.currency}</span>
          </span>
        ) : (
          <span>
            <span className="block text-[18px] font-bold tabular-nums">{q.responses}</span>
            <span className="mt-0.5 block text-[10.5px] font-semibold">photos</span>
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <Morph name={`q-${q.id}`}>
          <span className="line-clamp-2 text-[15.5px] font-semibold leading-snug tracking-tight">{q.prompt}</span>
        </Morph>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted">
          {here ? (
            <span className="inline-flex items-center gap-1 font-semibold text-ok">
              <LocateFixed className="size-3.5" aria-hidden /> You&apos;re here
            </span>
          ) : q.distance_m !== undefined ? (
            <span className="inline-flex items-center gap-1">
              <Navigation className="size-3.5" aria-hidden /> {walkHint(q.distance_m)}
            </span>
          ) : null}
          {open ? (
            <Countdown to={q.closes_at} />
          ) : (
            <span>{q.status === "expired" ? "Not enough answers" : "See what people saw"}</span>
          )}
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

function Preview({ q }: { q: QuestionSummary }) {
  const open = q.status === "open";
  const here = q.distance_m !== undefined && q.distance_m <= q.radius_m;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {open ? (
          <Badge tone="solid" size="md">
            {q.prize_amount} {q.currency} prize
          </Badge>
        ) : (
          <Badge size="md">Closed</Badge>
        )}
        {open && (
          <Badge size="md">
            <Countdown to={q.closes_at} />
          </Badge>
        )}
        <Badge size="md">
          <Users className="size-3.5" aria-hidden /> {q.responses} answered
        </Badge>
      </div>
      <h2 className="mt-3 text-[22px] font-semibold leading-snug tracking-tight text-balance">{q.prompt}</h2>
      {q.place_label && <p className="mt-1 text-[14.5px] text-muted">{q.place_label}</p>}
      <p className={cn("mt-3 flex items-center gap-2 text-[14.5px]", here ? "font-semibold text-ok" : "text-muted")}>
        {here ? <LocateFixed className="size-4" aria-hidden /> : <Navigation className="size-4" aria-hidden />}
        {here
          ? "You're close enough to answer."
          : q.distance_m !== undefined
            ? `${walkHint(q.distance_m)} away. Answer once you're within ${q.radius_m} m.`
            : `Answer within ${q.radius_m} m of the pin.`}
      </p>
      <div className="mt-5 grid gap-2">
        <Button asChild size="xl" block variant={open ? "primary" : "ink"}>
          <Link href={open ? `/q/${q.id}/answer` : `/q/${q.id}`} transitionTypes={["nav-forward"]}>
            {open ? (
              <>
                <Camera className="size-5" aria-hidden /> Answer this
              </>
            ) : (
              <>See results <ArrowRight className="size-5" aria-hidden /></>
            )}
          </Link>
        </Button>
        {open && !here && (
          <Button asChild variant="secondary" size="lg" block>
            <a href={directionsUrl(q.lat, q.lng)} target="_blank" rel="noreferrer">
              <Navigation className="size-4" aria-hidden /> Walking directions
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function LocationNotice({ state }: { state: LocationState }) {
  const [help, setHelp] = useState(false);
  if (state.status === "ok") return null;
  if (state.status === "pending") {
    return (
      <p className="mt-4 flex items-center gap-2.5 text-[14px] text-muted" role="status">
        <LiveDot tone="sky" /> Finding you. Showing questions around UC Berkeley for now.
      </p>
    );
  }
  return (
    <div className="mt-4 rounded-[18px] bg-surface p-4 ring-1 ring-line">
      <p className="flex items-start gap-2.5 text-[14.5px] leading-snug">
        <MapPinOff className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
        <span>
          <b className="font-semibold">
            {state.status === "unsupported" ? "This browser can’t share location." : state.message}
          </b>{" "}
          <span className="text-muted">You can still look around; you’ll need location to answer.</span>
        </span>
      </p>
      {state.status === "denied" && state.reason === "blocked" && (
        <div className="mt-3">
          {help ? (
            <PermissionHelp what="location" onRetry={() => location.reload()} />
          ) : (
            <Button variant="soft" size="sm" onClick={() => setHelp(true)}>
              How do I turn it on?
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <ul className="grid gap-2.5" aria-label="Loading questions" aria-busy>
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3.5 rounded-[20px] bg-surface p-3 ring-1 ring-line">
          <Skeleton className="size-[60px] rounded-[16px]" />
          <span className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-[85%]" />
            <Skeleton className="h-3 w-1/2" />
          </span>
        </li>
      ))}
    </ul>
  );
}
