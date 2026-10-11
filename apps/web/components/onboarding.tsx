"use client";
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Camera, CircleHelp, LocateFixed, MapPin, Sparkles, Ticket, Trophy } from "lucide-react";
import { useLocalFlag } from "@/hooks/use-local-flag";
import { haptic } from "@/lib/haptics";
import { Button } from "./ui/button";

export const ONBOARDED_KEY = "aeye:onboarded";

const STEPS = [
  {
    eyebrow: "What is A-eye?",
    title: "AI agents have questions about real places.",
    body: "“Is there a line at the coffee cart?” “Is the library open?” They can’t see. You can.",
    Art: AskArt,
  },
  {
    eyebrow: "How it works",
    title: "Walk up and snap a photo.",
    body: "Pick a question on the map, go to the spot, take a live photo and tap what you see. About 20 seconds.",
    Art: SnapArt,
  },
  {
    eyebrow: "Why bother?",
    title: "Every photo is a ticket to win the prize.",
    body: "When the question closes, one answer is drawn fairly and wins the pot. More answers, more chances.",
    Art: WinArt,
  },
] as const;

/** First-run intro. Three swipeable cards, then a friendly ask for location before the browser prompt. */
export function Onboarding() {
  const [done, setDone] = useLocalFlag(ONBOARDED_KEY);
  const path = usePathname();
  const show = done === false && !path.startsWith("/agents");
  return <AnimatePresence>{show && <OnboardingDialog onFinish={() => setDone(true)} />}</AnimatePresence>;
}

export function HowItWorksButton() {
  const [, setDone] = useLocalFlag(ONBOARDED_KEY);
  return (
    <button
      type="button"
      onClick={() => setDone(false)}
      className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      aria-label="How A-eye works"
      title="How A-eye works"
    >
      <CircleHelp className="size-[19px]" aria-hidden />
    </button>
  );
}

function OnboardingDialog({ onFinish }: { onFinish: () => void }) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [asking, setAsking] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const last = step === STEPS.length;

  useEffect(() => {
    primary.current?.focus();
  }, [step]);

  const go = (n: number) => {
    if (n < 0 || n > STEPS.length) return;
    setDir(n > step ? 1 : -1);
    setStep(n);
    haptic("tap");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(step + 1);
      if (e.key === "ArrowLeft") go(step - 1);
      if (e.key === "Escape") onFinish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -60 || info.velocity.x < -400) go(step + 1);
    else if (info.offset.x > 60 || info.velocity.x > 400) go(step - 1);
  };

  function allowLocation() {
    if (!navigator.geolocation) return onFinish();
    setAsking(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        haptic("success");
        onFinish();
      },
      () => onFinish(),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  const s = STEPS[Math.min(step, STEPS.length - 1)]!;
  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onb-title"
      className="bg-aurora fixed inset-0 z-[60] flex flex-col overflow-hidden"
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: reduce ? 1 : 1.02 }}
      transition={{ duration: 0.35 }}
    >
      <div className="mx-auto flex w-full max-w-[480px] items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <span className="text-[13px] font-medium text-muted">
          {last ? "Almost there" : `${step + 1} of ${STEPS.length}`}
        </span>
        <Button variant="ghost" size="sm" onClick={onFinish}>
          Skip
        </Button>
      </div>

      <div className="relative mx-auto flex w-full max-w-[480px] flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            className="absolute inset-0 flex touch-pan-y flex-col px-6"
            drag={reduce ? false : "x"}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.25}
            onDragEnd={onDragEnd}
            initial={reduce ? false : { x: dir * 80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: dir * -80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
          >
            <div className="grid flex-1 place-items-center py-4">
              {last ? <LocationArt /> : <s.Art />}
            </div>
            <div className="pb-4">
              <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent-ink">
                {last ? "One quick thing" : s.eyebrow}
              </p>
              <h2 id="onb-title" className="mt-2 text-[30px] font-semibold leading-[1.1] tracking-tight text-balance">
                {last ? "Share your location to see what’s nearby." : s.title}
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-muted text-pretty">
                {last
                  ? "We use it to show questions around you and to check you’re really at the spot. It’s never shown to anyone. Your browser will ask next."
                  : s.body}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mx-auto w-full max-w-[480px] px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mb-5 flex justify-center gap-2" role="tablist" aria-label="Intro steps">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === step}
              aria-label={`Step ${i + 1}`}
              onClick={() => go(i)}
              className="grid h-6 place-items-center"
            >
              <motion.span
                className="block h-2 rounded-full"
                animate={{ width: i === step ? 28 : 8, backgroundColor: i === step || last ? "var(--accent)" : "var(--surface-3)" }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            </button>
          ))}
        </div>
        {last ? (
          <div className="grid gap-2">
            <Button ref={primary} size="xl" block onClick={allowLocation} disabled={asking}>
              <LocateFixed className="size-5" aria-hidden /> {asking ? "Waiting for your browser" : "Show questions near me"}
            </Button>
            <Button variant="ghost" size="lg" block onClick={onFinish}>
              Not now, just browse
            </Button>
          </div>
        ) : (
          <Button ref={primary} size="xl" block onClick={() => go(step + 1)}>
            {step === 0 ? "Show me how" : "Next"} <ArrowRight className="size-5" aria-hidden />
          </Button>
        )}
      </div>
    </motion.div>
  );
}

/* Illustrations: built from tokens so they follow the theme. */

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid aspect-square w-full max-w-[300px] place-items-center rounded-[40px] bg-surface/70 shadow-lift ring-1 ring-line backdrop-blur">
      {children}
    </div>
  );
}

function AskArt() {
  const reduce = useReducedMotion();
  return (
    <Stage>
      <svg viewBox="0 0 200 200" className="absolute inset-6 opacity-60" aria-hidden>
        <path d="M0 140 C60 120 80 170 200 120" stroke="var(--line)" strokeWidth="10" fill="none" />
        <path d="M60 0 C70 80 40 120 70 200" stroke="var(--line)" strokeWidth="8" fill="none" />
      </svg>
      {[
        { x: "28%", y: "62%", d: 0 },
        { x: "70%", y: "70%", d: 0.4 },
        { x: "56%", y: "38%", d: 0.8 },
      ].map((p, i) => (
        <motion.span
          key={i}
          className="absolute -translate-x-1/2 -translate-y-full"
          style={{ left: p.x, top: p.y }}
          initial={reduce ? false : { y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 14, delay: 0.2 + p.d }}
        >
          <span className="absolute left-1/2 top-full size-6 -translate-x-1/2 -translate-y-1/2 animate-pulse-ring rounded-full bg-accent/40" />
          <MapPin className="relative size-9 fill-accent text-on-accent" strokeWidth={1.6} aria-hidden />
        </motion.span>
      ))}
      <motion.div
        className="absolute left-5 right-5 top-6 rounded-[18px] rounded-bl-[6px] bg-surface px-4 py-3 text-[14px] font-medium shadow-panel ring-1 ring-line"
        initial={reduce ? false : { y: 12, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 18, delay: 1.1 }}
      >
        <span className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
          <Sparkles className="size-3.5 text-accent" aria-hidden /> AI agent
        </span>
        Is there a line at the coffee cart right now?
      </motion.div>
    </Stage>
  );
}

function SnapArt() {
  const reduce = useReducedMotion();
  return (
    <Stage>
      <div className="relative h-[78%] w-[52%] overflow-hidden rounded-[28px] bg-ink p-2 shadow-lift">
        <div className="relative size-full overflow-hidden rounded-[22px] bg-gradient-to-b from-[#7fb4ff] via-[#ffd2a8] to-[#e6a173]">
          <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-[#4f7a4a]" />
          <div className="absolute bottom-[30%] left-[18%] h-[28%] w-[26%] rounded-t-[8px] bg-[#c25b35]" />
          <div className="absolute bottom-[30%] left-[50%] h-[18%] w-[34%] rounded-t-[6px] bg-[#8a4b2a]" />
          {[0, 1, 2, 3].map((c) => (
            <span
              key={c}
              className="absolute size-4 border-white/90"
              style={{
                top: c < 2 ? 10 : undefined,
                bottom: c >= 2 ? 10 : undefined,
                left: c % 2 === 0 ? 10 : undefined,
                right: c % 2 === 1 ? 10 : undefined,
                borderTopWidth: c < 2 ? 2 : 0,
                borderBottomWidth: c >= 2 ? 2 : 0,
                borderLeftWidth: c % 2 === 0 ? 2 : 0,
                borderRightWidth: c % 2 === 1 ? 2 : 0,
              }}
            />
          ))}
          <motion.div
            className="absolute inset-0 bg-white"
            initial={{ opacity: 0 }}
            animate={reduce ? { opacity: 0 } : { opacity: [0, 0, 0.9, 0] }}
            transition={{ duration: 2.4, times: [0, 0.55, 0.6, 0.8], repeat: Infinity, repeatDelay: 0.6 }}
          />
        </div>
        <div className="absolute bottom-4 left-1/2 grid size-11 -translate-x-1/2 place-items-center rounded-full bg-white/90 ring-4 ring-white/40">
          <Camera className="size-5 text-ink" aria-hidden />
        </div>
      </div>
      <motion.span
        className="absolute bottom-8 right-6 inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1.5 text-[13px] font-semibold text-ok shadow-panel"
        initial={reduce ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.9 }}
      >
        <LocateFixed className="size-4" aria-hidden /> You’re at the spot
      </motion.span>
    </Stage>
  );
}

function WinArt() {
  const reduce = useReducedMotion();
  return (
    <Stage>
      {[...Array(10)].map((_, i) => (
        <motion.span
          key={i}
          className="absolute size-2.5 rounded-[3px]"
          style={{ left: `${10 + i * 8}%`, top: "8%", background: i % 3 === 0 ? "var(--accent)" : i % 3 === 1 ? "var(--accent-2)" : "var(--sky)" }}
          animate={reduce ? undefined : { y: [0, 200], rotate: [0, 260], opacity: [0, 1, 0] }}
          transition={{ duration: 2.6, delay: i * 0.22, repeat: Infinity, ease: "easeIn" }}
        />
      ))}
      <motion.div
        className="relative grid size-32 place-items-center rounded-[36px] bg-gradient-to-br from-accent to-accent-2 text-white shadow-lift"
        initial={reduce ? false : { scale: 0.5, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 12 }}
      >
        <Trophy className="size-16" strokeWidth={1.6} aria-hidden />
      </motion.div>
      <motion.span
        className="absolute bottom-8 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface px-3.5 py-2 text-[13.5px] font-semibold shadow-panel ring-1 ring-line"
        initial={reduce ? false : { y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <Ticket className="size-4 text-accent" aria-hidden /> 1 photo = 1 entry
      </motion.span>
    </Stage>
  );
}

function LocationArt() {
  return (
    <Stage>
      <span className="absolute size-24 animate-pulse-ring rounded-full bg-sky/30" />
      <span className="absolute size-24 animate-pulse-ring rounded-full bg-sky/30 [animation-delay:1.1s]" />
      <span className="relative grid size-20 place-items-center rounded-full bg-sky text-white shadow-lift ring-8 ring-white/60 dark:ring-white/10">
        <LocateFixed className="size-9" aria-hidden />
      </span>
    </Stage>
  );
}
