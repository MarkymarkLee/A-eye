"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CircleAlert,
  Footprints,
  Globe,
  LocateFixed,
  Navigation,
  RotateCcw,
  Satellite,
  Send,
  Ticket,
  Wallet, Plus } from "lucide-react";
import { GEO_RULES, PLATFORM_FEE, type QuestionSummary } from "@a-eye/shared";
import { useLocation, type Fix, type LocationState } from "@/hooks/use-location";
import { usePermission } from "@/hooks/use-permission";
import { distanceM, formatDistance } from "@/lib/geo";
import { celebrate } from "@/lib/confetti";
import { haptic } from "@/lib/haptics";
import { directionsUrl, walkHint } from "@/lib/walk";
import { cn } from "@/lib/cn";
import { matchSpokenOption, spokenQuestion } from "@/lib/voice-match";
import { Morph } from "./motion/page";
import { PermissionHelp } from "./permission-help";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Countdown } from "./ui/countdown";
import { Skeleton } from "./ui/skeleton";
import { ReadAloudButton, SpeakAnswerButton } from "./voice-controls";

type Question = Omit<QuestionSummary, "distance_m"> & { web_baseline?: { answer: string; source: string }; gallery_url: string };
type Shot = { blob: Blob; url: string; capturedAt: string };
type Phase = { kind: "idle" } | { kind: "sending"; progress: number } | { kind: "done"; distance_m: number };

export function AnswerFlow({ question: q, voice }: { question: Question; voice: boolean }) {
  const perm = usePermission("geolocation");
  const [asked, setAsked] = useState(false);
  // Only start GPS (which can trigger the browser prompt) once we've explained why, or it's already allowed.
  const loc = useLocation(perm === "granted" || asked);
  const [shot, setShot] = useState<Shot | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [freeText, setFreeText] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<{ text: string; index: number | null } | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function moveChoice(from: number, delta: number) {
    const n = q.options.length;
    const next = (from + delta + n) % n;
    setChoice(next);
    haptic("select");
    optionRefs.current[next]?.focus();
  }

  function onTranscript(text: string) {
    const index = matchSpokenOption(text, q.options);
    setHeard({ text, index });
    if (index !== null) setChoice(index);
    else if (q.allow_free_text && !freeText.trim()) setFreeText(text.slice(0, 280));
  }

  const fix = loc.status === "ok" ? loc.fix : undefined;
  const distance = fix ? Math.round(distanceM(q.lat, q.lng, fix.lat, fix.lng)) : undefined;
  const accurate = fix ? fix.accuracy <= GEO_RULES.maxAccuracyM : false;
  const inRange = fix && distance !== undefined ? distance <= q.radius_m + fix.accuracy : false;
  const ready = Boolean(shot && choice !== null && fix && accurate && inRange);
  const sending = phase.kind === "sending";

  const wasInRange = useRef(false);
  useEffect(() => {
    if (inRange && accurate && !wasInRange.current) haptic("success");
    wasInRange.current = inRange && accurate;
  }, [inRange, accurate]);

  async function submit() {
    if (!shot || choice === null || !fix) return;
    if (Date.now() - Date.parse(shot.capturedAt) > GEO_RULES.maxClockSkewMs) {
      setError("That photo is over 2 minutes old. Retake it so it shows right now.");
      haptic("error");
      return;
    }
    setPhase({ kind: "sending", progress: 0 });
    setError(null);
    const body = new FormData();
    body.set("image", shot.blob, "capture.jpg");
    body.set("option_index", String(choice));
    if (freeText.trim()) body.set("free_text", freeText.trim());
    body.set("lat", String(fix.lat));
    body.set("lng", String(fix.lng));
    body.set("accuracy_m", String(fix.accuracy));
    body.set("captured_at", shot.capturedAt);
    try {
      const json = await upload(`/api/questions/${q.id}/submissions`, body, (p) => setPhase({ kind: "sending", progress: p }));
      haptic("success");
      setPhase({ kind: "done", distance_m: json.distance_m });
      window.scrollTo({ top: 0 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error. Try again.";
      setError(msg);
      toast.error("Not sent yet", { description: msg });
      haptic("error");
      setPhase({ kind: "idle" });
    }
  }

  if (phase.kind === "done") return <Entered q={q} distance={phase.distance_m} fix={fix} />;

  const step = !shot ? 1 : choice === null ? 2 : 3;
  return (
    <main className="mx-auto max-w-[1200px] px-4 pb-32 pt-4 md:px-6 md:pt-8">
      <Link
        href="/"
        transitionTypes={["nav-back"]}
        className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-full px-2 text-[14px] font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden /> Nearby
      </Link>

      <div className="mt-2 grid gap-6 md:grid-cols-[1fr_1fr] md:gap-12">
        <div className="md:sticky md:top-[84px] md:self-start">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="solid" size="md">
              <Ticket className="size-3.5" aria-hidden /> Win {payout(q)} {q.currency}
            </Badge>
            <Badge size="md">
              <Countdown to={q.closes_at} />
            </Badge>
            <Badge size="md">
              {q.responses}/{q.max_responses} answered
            </Badge>
          </div>
          <Morph name={`q-${q.id}`}>
            <h1 className="mt-3 text-[28px] font-semibold leading-[1.12] tracking-tight text-balance md:text-[40px]">{q.prompt}</h1>
          </Morph>
          {q.place_label && <p className="mt-2 text-[15px] text-muted">{q.place_label}</p>}
          {voice && (
            <div className="mt-3">
              <ReadAloudButton text={spokenQuestion(q.prompt, q.options)} />
            </div>
          )}
          {q.web_baseline && (
            <p className="mt-4 flex max-w-[52ch] gap-2.5 rounded-[16px] bg-surface-2 p-3.5 text-[14px] leading-relaxed text-muted">
              <Globe className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                The internet says &ldquo;{q.web_baseline.answer}&rdquo;. Your photo shows what&apos;s really true.
              </span>
            </p>
          )}
          <Presence
            perm={perm}
            asked={asked}
            onAsk={() => setAsked(true)}
            loc={loc}
            distance={distance}
            q={q}
            inRange={inRange}
            accurate={accurate}
          />
        </div>

        <div className="space-y-7">
          <StepTitle n={1} active={step === 1} done={Boolean(shot)}>
            Take a live photo
          </StepTitle>
          <CameraCapture shot={shot} onShot={setShot} />

          <fieldset>
            <legend className="w-full">
              <StepTitle n={2} active={step === 2} done={choice !== null}>
                What do you see?
              </StepTitle>
            </legend>
            {voice && (
              <div className="mt-3">
                <SpeakAnswerButton onTranscript={onTranscript} />
                {heard && (
                  <p className="mt-2 text-[13px] leading-snug text-muted" aria-live="polite">
                    Heard &ldquo;{heard.text}&rdquo;.{" "}
                    {heard.index !== null ? `Picked ${q.options[heard.index]}.` : "Tap the answer that matches."}
                  </p>
                )}
              </div>
            )}
            <div className="mt-3 grid gap-2" role="radiogroup" aria-label="Answer options">
              {q.options.map((opt, i) => {
                const active = choice === i;
                return (
                  <motion.button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    whileTap={{ scale: 0.98 }}
                    ref={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    tabIndex={choice === i || (choice === null && i === 0) ? 0 : -1}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                        e.preventDefault();
                        moveChoice(i, 1);
                      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                        e.preventDefault();
                        moveChoice(i, -1);
                      }
                    }}
                    onClick={() => {
                      setChoice(i);
                      haptic("select");
                    }}
                    className={cn(
                      "flex min-h-14 items-center justify-between gap-3 rounded-[18px] px-5 text-left text-[16px] font-medium transition-colors",
                      active ? "bg-ink text-bg shadow-lift" : "bg-surface text-ink ring-1 ring-line hover:bg-surface-2",
                    )}
                  >
                    {opt}
                    <span
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-full transition-colors",
                        active ? "bg-accent text-on-accent" : "ring-2 ring-surface-3",
                      )}
                    >
                      <AnimatePresence>
                        {active && (
                          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                            <Check className="size-4" strokeWidth={3} aria-hidden />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </fieldset>

          {q.allow_free_text && !noteOpen && !freeText && (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 self-start rounded-full px-1 text-[15px] font-medium text-accent-ink hover:underline"
            >
              <Plus className="size-4" aria-hidden /> Add a note <span className="font-normal text-muted">(optional)</span>
            </button>
          )}
          {q.allow_free_text && (noteOpen || freeText) && (
            <div className="grid gap-2">
              <label htmlFor="note" className="text-[15px] font-medium">
                Anything to add? <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="note"
                rows={2}
                maxLength={280}
                value={freeText}
                autoFocus={noteOpen && !freeText}
                onChange={(e) => setFreeText(e.target.value)}
                className="field resize-none"
                aria-describedby="note-help"
              />
              <p id="note-help" className="text-[13px] text-muted">
                The agent reads this next to your photo.
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-[14px] bg-bad-soft px-3.5 py-3 text-[14px] text-bad">
              <CircleAlert className="mt-px size-[18px] shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/90 px-4 pt-3 backdrop-blur-xl [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
          <p className="text-[13.5px] leading-snug text-muted" aria-live="polite">
            {sending ? (phase.progress < 1 ? "Sending your photo…" : "Checking you were at the spot…") : nextStep({ shot, choice, fix, accurate, inRange })}
          </p>
          <Button onClick={submit} disabled={!ready || sending} size="lg" className="relative shrink-0 overflow-hidden">
            {sending && (
              <motion.span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-white/30"
                animate={{ width: `${Math.max(8, phase.progress * 100)}%` }}
                transition={{ ease: "easeOut" }}
              />
            )}
            <span className="relative inline-flex items-center gap-2">
              {sending ? `${Math.round(phase.progress * 100)}%` : "Send answer"}
              {!sending && <Send className="size-4" aria-hidden />}
            </span>
          </Button>
        </div>
      </div>
    </main>
  );
}

function payout(q: Pick<Question, "prize_amount">) {
  return Math.round(q.prize_amount * (1 - PLATFORM_FEE) * 100) / 100;
}

/** Multipart POST with upload progress (fetch can't report it). Same endpoint and body as before. */
function upload(url: string, body: FormData, onProgress: (p: number) => void) {
  return new Promise<{ distance_m: number }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.upload.onload = () => onProgress(1);
    xhr.onerror = () => reject(new Error("Network error. Check your connection and try again."));
    xhr.onload = () => {
      let json: { error?: string; distance_m?: number } = {};
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        // Non-JSON error page.
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(json as { distance_m: number });
      else reject(new Error(json.error ?? "Something went wrong. Try again."));
    };
    xhr.send(body);
  });
}

function StepTitle({ n, active, done, children }: { n: number; active: boolean; done: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2.5 text-[16px] font-semibold tracking-tight">
      <span
        className={cn(
          "grid size-7 place-items-center rounded-full text-[13px] font-bold transition-colors",
          done ? "bg-ok text-white" : active ? "bg-accent text-on-accent" : "bg-surface-2 text-muted",
        )}
      >
        {done ? <Check className="size-4" strokeWidth={3} aria-hidden /> : n}
      </span>
      {children}
    </span>
  );
}

function nextStep(s: { shot: Shot | null; choice: number | null; fix?: unknown; accurate: boolean; inRange: boolean }) {
  if (!s.fix) return "We need your location first.";
  if (!s.accurate) return "Waiting for a clearer GPS signal.";
  if (!s.inRange) return "Walk a bit closer to the pin.";
  if (!s.shot) return "Take a photo of what you see.";
  if (s.choice === null) return "Tap the answer that matches.";
  return "All set. One answer per person.";
}

function Presence(props: {
  perm: ReturnType<typeof usePermission>;
  asked: boolean;
  onAsk: () => void;
  loc: LocationState;
  distance?: number;
  q: Question;
  inRange: boolean;
  accurate: boolean;
}) {
  const { perm, asked, onAsk, loc, distance, q, inRange, accurate } = props;
  const box = "mt-5 rounded-[20px] p-4 ring-1";
  let body: React.ReactNode;

  if (perm === "unknown") {
    body = <Skeleton className="h-[76px] rounded-[20px]" />;
    return <div className="mt-5">{body}</div>;
  }
  if (loc.status === "denied" || perm === "denied") {
    const blocked = perm === "denied" || (loc.status === "denied" && loc.reason === "blocked");
    return (
      <div className={cn(box, "bg-surface ring-line")} role="status">
        <Row icon={<Satellite className="size-5" aria-hidden />} tone="warn" title={blocked ? "Location is off" : "Can’t find you yet"}>
          {blocked
            ? "We only use it to check you’re at the spot. Nobody else sees it."
            : "Step outside or near a window, then try again."}
        </Row>
        {blocked ? (
          <div className="mt-3">
            <PermissionHelp what="location" onRetry={() => location.reload()} />
          </div>
        ) : (
          <Button className="mt-3" block size="lg" variant="secondary" onClick={() => location.reload()}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (perm === "prompt" && !asked) {
    return (
      <div className={cn(box, "bg-surface ring-line")}>
        <Row icon={<LocateFixed className="size-5" aria-hidden />} tone="sky" title="First, are you at the spot?">
          Share your location so we can check you&apos;re within {formatDistance(q.radius_m)} of the pin. Your browser will ask
          once.
        </Row>
        <Button className="mt-3" block size="lg" onClick={onAsk}>
          <LocateFixed className="size-5" aria-hidden /> Check my location
        </Button>
      </div>
    );
  }
  if (loc.status === "unsupported") {
    return (
      <div className={cn(box, "bg-surface ring-line")}>
        <Row icon={<Satellite className="size-5" aria-hidden />} tone="warn" title="This browser can’t share location">
          Try Safari or Chrome on your phone to answer.
        </Row>
      </div>
    );
  }
  if (loc.status === "pending") {
    return (
      <div className={cn(box, "bg-surface ring-line")} role="status">
        <Row icon={<Searching />} tone="sky" title="Finding you…">
          This takes a few seconds. Being outside helps.
        </Row>
      </div>
    );
  }
  const fix = loc.fix;
  if (!accurate) {
    return (
      <div className={cn(box, "bg-warn-soft ring-transparent")} role="status">
        <Row icon={<Searching />} tone="warn" title="Your GPS is a little fuzzy">
          It&apos;s accurate to about {Math.round(fix.accuracy)} m right now; we need {GEO_RULES.maxAccuracyM} m. Step outside or
          wait a moment.
        </Row>
      </div>
    );
  }
  if (!inRange) {
    const extra = Math.max(0, distance! - q.radius_m);
    const closeness = Math.max(0.06, Math.min(1, q.radius_m / distance!));
    return (
      <div className={cn(box, "bg-surface ring-line")} role="status" aria-live="polite">
        <Row icon={<Footprints className="size-5" aria-hidden />} tone="accent" title={`Walk about ${formatDistance(extra)} closer`}>
          You&apos;re {walkHint(distance!)} from the pin. Answers open within {formatDistance(q.radius_m)}.
        </Row>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
            animate={{ width: `${closeness * 100}%` }}
            transition={{ type: "spring", stiffness: 80, damping: 20 }}
          />
        </div>
        <Button asChild variant="secondary" size="md" className="mt-3">
          <a href={directionsUrl(q.lat, q.lng)} target="_blank" rel="noreferrer">
            <Navigation className="size-4" aria-hidden /> Directions
          </a>
        </Button>
      </div>
    );
  }
  return (
    <motion.div
      initial={{ scale: 0.97, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={cn(box, "bg-ok-soft ring-transparent")}
      role="status"
    >
      <Row icon={<Check className="size-5" strokeWidth={3} aria-hidden />} tone="ok" title="You’re at the spot">
        {formatDistance(distance!)} from the pin. Go ahead and take your photo.
      </Row>
    </motion.div>
  );
}

function Row({ icon, tone, title, children }: { icon: React.ReactNode; tone: "ok" | "warn" | "sky" | "accent"; title: string; children: React.ReactNode }) {
  const tones = {
    ok: "bg-ok text-white",
    warn: "bg-warn text-white dark:text-bg",
    sky: "bg-sky text-white",
    accent: "bg-accent text-on-accent",
  };
  return (
    <div className="flex items-start gap-3">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", tones[tone])}>{icon}</span>
      <div>
        <p className="text-[15.5px] font-semibold tracking-tight">{title}</p>
        <p className="mt-0.5 text-[14px] leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  );
}

function Searching() {
  return (
    <span className="relative grid size-5 place-items-center" aria-hidden>
      <span className="absolute inset-0 animate-pulse-ring rounded-full bg-white/60" />
      <LocateFixed className="relative size-5" />
    </span>
  );
}

/** In-app camera only: getUserMedia to canvas to JPEG. There is deliberately no file picker. */
function CameraCapture({ shot, onShot }: { shot: Shot | null; onShot: (s: Shot | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"idle" | "starting" | "live" | "blocked" | "error">("idle");
  const [message, setMessage] = useState("");
  const [flash, setFlash] = useState(0);
  const reduce = useReducedMotion();

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => stop, []);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setMessage("This browser can’t open the camera. Try Safari or Chrome.");
      return;
    }
    setState("starting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 1600 } },
        audio: false,
      });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      setState("live");
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        setState("blocked");
      } else if (e instanceof DOMException && (e.name === "NotFoundError" || e.name === "OverconstrainedError")) {
        setState("error");
        setMessage("We couldn’t find a camera. Open this page on a phone with a camera.");
      } else {
        setState("error");
        setMessage("The camera didn’t start. Close other apps using it and try again.");
      }
      haptic("error");
    }
  }

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    const capturedAt = new Date().toISOString();
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setFlash((n) => n + 1);
        haptic("success");
        onShot({ blob, url: URL.createObjectURL(blob), capturedAt });
        stop();
        setState("idle");
      },
      "image/jpeg",
      0.82,
    );
  }

  function retake() {
    if (shot) URL.revokeObjectURL(shot.url);
    onShot(null);
    start();
  }

  return (
    <div>
      <div className="relative aspect-[4/5] overflow-hidden rounded-[24px] bg-ink shadow-lift">
        <video
          ref={video}
          playsInline
          muted
          aria-label="Camera preview"
          className={cn("absolute inset-0 size-full object-cover transition-opacity", state === "live" ? "opacity-100" : "opacity-0")}
        />
        {shot && (
          <motion.img
            src={shot.url}
            alt="Your photo"
            initial={reduce ? false : { scale: 1.06 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 160, damping: 20 }}
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {(state === "live" || shot) && <Corners />}
        {shot && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[12.5px] font-semibold text-white backdrop-blur">
            <Check className="size-3.5" strokeWidth={3} aria-hidden /> Photo ready
          </span>
        )}
        {!shot && state !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-[#1d1f23] to-[#0b0c0e] px-7 text-center text-white">
            {state === "blocked" ? (
              <div className="w-full max-w-[320px] text-ink">
                <p className="mb-3 text-[15px] font-semibold text-white">Camera is blocked</p>
                <PermissionHelp what="camera" onRetry={start} />
              </div>
            ) : (
              <>
                <span className="grid size-16 place-items-center rounded-full bg-white/10 ring-1 ring-white/15">
                  {state === "starting" ? <span className="size-6 animate-pulse rounded-full bg-white/70" /> : <Camera className="size-7" aria-hidden />}
                </span>
                <p className="max-w-[28ch] text-[14.5px] leading-relaxed text-white/75">
                  {state === "error"
                    ? message
                    : state === "starting"
                      ? "Opening your camera…"
                      : "Photos are taken live here, so the agent knows they’re from right now. Your browser will ask for the camera."}
                </p>
                {state !== "starting" && (
                  <Button size="lg" onClick={start} className="mt-1">
                    <Camera className="size-5" aria-hidden /> {state === "error" ? "Try again" : "Open camera"}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
        {state === "live" && (
          <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/50 to-transparent pb-5 pt-12">
            <motion.button
              type="button"
              onClick={capture}
              whileTap={{ scale: 0.9 }}
              aria-label="Take photo"
              className="grid size-[76px] place-items-center rounded-full bg-white/25 ring-4 ring-white backdrop-blur-sm"
            >
              <span className="size-[60px] rounded-full bg-white" />
            </motion.button>
          </div>
        )}
        <AnimatePresence>
          {flash > 0 && !reduce && (
            <motion.div
              key={flash}
              className="pointer-events-none absolute inset-0 bg-white"
              initial={{ opacity: 0.9 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            />
          )}
        </AnimatePresence>
      </div>
      {shot && (
        <Button variant="secondary" className="mt-3" onClick={retake}>
          <RotateCcw className="size-4" aria-hidden /> Retake
        </Button>
      )}
    </div>
  );
}

function Corners() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-4">
      {["left-0 top-0 border-l-[3px] border-t-[3px] rounded-tl-[12px]", "right-0 top-0 border-r-[3px] border-t-[3px] rounded-tr-[12px]", "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-[12px]", "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-[12px]"].map(
        (c) => (
          <span key={c} className={cn("absolute size-7 border-white/90", c)} />
        ),
      )}
    </span>
  );
}

type Next = Pick<QuestionSummary, "id" | "prompt" | "prize_amount" | "currency" | "closes_at" | "distance_m" | "place_label">;

/** The "You're entered!" moment: confetti, a ticket, and the next nearby question so people keep going. */
function Entered({ q, distance, fix }: { q: Question; distance: number; fix?: Fix }) {
  const reduce = useReducedMotion();
  const [next, setNext] = useState<Next | null | undefined>(undefined);

  useEffect(() => {
    void celebrate();
  }, []);

  useEffect(() => {
    const lat = fix?.lat ?? q.lat;
    const lng = fix?.lng ?? q.lng;
    Promise.all([
      fetch(`/api/questions?lat=${lat}&lng=${lng}&max_km=5`, { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/me", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ entries: [] })),
    ])
      .then(([j, me]: [{ questions: QuestionSummary[] }, { entries?: { question_id: string }[] }]) => {
        const done = new Set([q.id, ...(me.entries ?? []).map((e) => e.question_id)]);
        const open = j.questions
          .filter((x) => x.status === "open" && !done.has(x.id))
          .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
        setNext(open[0] ?? null);
      })
      .catch(() => setNext(null));
  }, [q.id, q.lat, q.lng, fix?.lat, fix?.lng]);

  const entries = q.responses + 1;
  return (
    <main className="bg-aurora mx-auto flex min-h-[calc(100dvh-60px)] max-w-[560px] flex-col px-4 pb-16 pt-8">
      <motion.div
        initial={reduce ? false : { scale: 0.6, rotate: -8, opacity: 0 }}
        animate={{ scale: 1, rotate: -3, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 14 }}
        className="relative mx-auto w-full max-w-[330px] overflow-hidden rounded-[26px] bg-gradient-to-br from-accent to-accent-2 p-5 text-white shadow-lift"
      >
        <span aria-hidden className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-bg" />
        <span aria-hidden className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-bg" />
        <div className="flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.1em] opacity-90">
          <span>Raffle ticket</span>
          <Ticket className="size-5" aria-hidden />
        </div>
        <p className="mt-5 text-[13px] font-medium opacity-85">Prize</p>
        <p className="text-[38px] font-bold leading-none tabular-nums">
          {payout(q)} <span className="text-[18px]">{q.currency}</span>
        </p>
        <div className="mt-5 border-t border-dashed border-white/40 pt-3 text-[13px] font-medium opacity-90">
          Draw <Countdown to={q.closes_at} suffix="" icon={false} className="font-semibold" /> · {entries === 1 ? "first entry" : `1 of ${entries} entries`}
        </div>
      </motion.div>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mt-8 text-center"
      >
        <h1 className="text-[34px] font-semibold leading-tight tracking-tight">You&apos;re entered!</h1>
        <p className="mx-auto mt-2 max-w-[36ch] text-[15.5px] leading-relaxed text-muted">
          Verified {formatDistance(distance)} from the spot. When the question closes, one answer wins the prize.
        </p>
      </motion.div>

      <motion.section
        initial={reduce ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mt-8"
        aria-label="Next question nearby"
      >
        {next === undefined ? (
          <Skeleton className="h-[148px] rounded-[22px]" />
        ) : next ? (
          <div className="rounded-[22px] bg-surface p-4 shadow-lift ring-1 ring-line">
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-accent-ink">Keep going · next one nearby</p>
            <p className="mt-1.5 text-[17px] font-semibold leading-snug tracking-tight">{next.prompt}</p>
            <p className="mt-1 text-[13.5px] text-muted">
              Win {payout(next)} {next.currency}
              {next.distance_m !== undefined && <> · {walkHint(next.distance_m)}</>}
            </p>
            <Button asChild size="lg" block className="mt-3.5">
              <Link href={`/q/${next.id}/answer`} transitionTypes={["nav-forward"]}>
                Answer next <ArrowRight className="size-5" aria-hidden />
              </Link>
            </Button>
          </div>
        ) : (
          <p className="rounded-[22px] bg-surface p-4 text-center text-[14.5px] text-muted ring-1 ring-line">
            You&apos;ve answered everything nearby. New questions show up on the map.
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button asChild variant="secondary" size="lg">
            <Link href={`/q/${q.id}`} transitionTypes={["nav-forward"]}>
              Live results
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/me">
              <Wallet className="size-4" aria-hidden /> Get paid
            </Link>
          </Button>
        </div>
      </motion.section>
    </main>
  );
}
