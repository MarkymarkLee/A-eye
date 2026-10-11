"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Camera, CheckCircle, Crosshair, ArrowCounterClockwise, Ticket, WarningCircle } from "@phosphor-icons/react";
import { GEO_RULES, PLATFORM_FEE, type QuestionSummary } from "@a-eye/shared";
import { useLocation } from "@/hooks/use-location";
import { distanceM, formatDistance } from "@/lib/geo";
import { timeLeft } from "@/lib/time";

type Question = Omit<QuestionSummary, "distance_m"> & { web_baseline?: { answer: string; source: string }; gallery_url: string };
type Shot = { blob: Blob; url: string; capturedAt: string };

export function AnswerFlow({ question: q }: { question: Question }) {
  const loc = useLocation();
  const [shot, setShot] = useState<Shot | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [freeText, setFreeText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ distance_m: number } | null>(null);

  const fix = loc.status === "ok" ? loc.fix : undefined;
  const distance = fix ? Math.round(distanceM(q.lat, q.lng, fix.lat, fix.lng)) : undefined;
  const accurate = fix ? fix.accuracy <= GEO_RULES.maxAccuracyM : false;
  const inRange = fix && distance !== undefined ? distance <= q.radius_m + fix.accuracy : false;
  const ready = Boolean(shot && choice !== null && fix && accurate && inRange);

  async function submit() {
    if (!shot || choice === null || !fix) return;
    if (Date.now() - Date.parse(shot.capturedAt) > GEO_RULES.maxClockSkewMs) {
      setError("That photo is over 2 minutes old. Retake it so it reflects right now.");
      return;
    }
    setSending(true);
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
      const res = await fetch(`/api/questions/${q.id}/submissions`, { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong. Try again.");
      setDone({ distance_m: json.distance_m });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (done) return <Done q={q} distance={done.distance_m} />;

  return (
    <main className="mx-auto max-w-[1100px] px-4 pb-28 pt-5 md:px-6 md:pt-8">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} weight="bold" /> Nearby
      </Link>

      <div className="mt-4 grid gap-8 md:grid-cols-[1fr_1fr] md:gap-12">
        <div className="md:sticky md:top-[84px] md:self-start">
          <h1 className="text-[28px] font-semibold leading-[1.15] tracking-tight md:text-[40px]">{q.prompt}</h1>
          <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-line pt-4 text-sm">
            <div>
              <dt className="text-muted">Raffle pot</dt>
              <dd className="mt-0.5 font-mono font-semibold text-accent-ink">
                {q.prize_amount} {q.currency}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Closes</dt>
              <dd className="mt-0.5 font-medium">{timeLeft(q.closes_at)}</dd>
            </div>
            <div>
              <dt className="text-muted">Answers</dt>
              <dd className="mt-0.5 font-mono font-medium">
                {q.responses}/{q.max_responses}
              </dd>
            </div>
          </dl>
          {q.place_label && <p className="mt-4 text-[15px] text-muted">At {q.place_label}, within {formatDistance(q.radius_m)}.</p>}
          {q.web_baseline && (
            <p className="mt-2 max-w-[52ch] text-[14px] leading-relaxed text-muted">
              The web says: &ldquo;{q.web_baseline.answer}&rdquo;. Your photo tells the agent what&apos;s actually true.
            </p>
          )}
          <PresenceStatus loc={loc} distance={distance} radius={q.radius_m} inRange={inRange} accurate={accurate} />
        </div>

        <div className="space-y-7">
          <CameraCapture shot={shot} onShot={setShot} />

          <fieldset>
            <legend className="text-[15px] font-medium">What do you see?</legend>
            <div className="mt-3 grid gap-2">
              {q.options.map((opt, i) => {
                const active = choice === i;
                return (
                  <button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setChoice(i)}
                    className={`btn justify-between px-5 py-3.5 text-left text-[16px] ${
                      active ? "bg-ink text-bg" : "bg-surface text-ink ring-1 ring-line hover:bg-surface-2"
                    }`}
                  >
                    {opt}
                    {active && <CheckCircle size={20} weight="fill" />}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {q.allow_free_text && (
            <div className="grid gap-2">
              <label htmlFor="note" className="text-[15px] font-medium">
                Anything to add? <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="note"
                rows={2}
                maxLength={280}
                value={freeText}
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
            <p role="alert" className="flex items-start gap-2 rounded-[12px] bg-bad/10 px-3 py-2.5 text-[14px] text-bad">
              <WarningCircle size={18} weight="bold" className="mt-px shrink-0" />
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/90 px-4 py-3 backdrop-blur-md [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-4">
          <p className="text-[13px] leading-snug text-muted">{nextStep({ shot, choice, fix, accurate, inRange })}</p>
          <button type="button" onClick={submit} disabled={!ready || sending} className="btn btn-primary shrink-0">
            {sending ? "Sending" : "Submit answer"}
            {!sending && <ArrowRight size={16} weight="bold" />}
          </button>
        </div>
      </div>
    </main>
  );
}

function nextStep(s: { shot: Shot | null; choice: number | null; fix?: unknown; accurate: boolean; inRange: boolean }) {
  if (!s.fix) return "Waiting for your location.";
  if (!s.accurate) return "Waiting for a sharper GPS fix.";
  if (!s.inRange) return "Get closer to the spot to answer.";
  if (!s.shot) return "Take a photo of what you see.";
  if (s.choice === null) return "Pick the answer that matches.";
  return "Ready. One answer per person.";
}

function PresenceStatus(props: {
  loc: ReturnType<typeof useLocation>;
  distance?: number;
  radius: number;
  inRange: boolean;
  accurate: boolean;
}) {
  const { loc, distance, radius, inRange, accurate } = props;
  let tone = "text-muted";
  let text: string;
  if (loc.status === "pending") text = "Finding your location";
  else if (loc.status === "unsupported") text = "This browser can't share location";
  else if (loc.status === "denied") text = loc.message;
  else if (!accurate) text = `GPS is accurate to ${Math.round(loc.fix.accuracy)} m. We need ${GEO_RULES.maxAccuracyM} m or better.`;
  else if (!inRange) {
    tone = "text-bad";
    text = `You're ${formatDistance(distance!)} away. Get within ${formatDistance(radius)}.`;
  } else {
    tone = "text-ok";
    text = `You're here: ${formatDistance(distance!)} from the spot, GPS within ${Math.round(loc.fix.accuracy)} m.`;
  }
  return (
    <p className={`mt-6 flex items-start gap-2 text-[14px] leading-snug ${tone}`} aria-live="polite">
      <Crosshair size={18} weight="bold" className="mt-px shrink-0" />
      {text}
    </p>
  );
}

/** In-app camera only: getUserMedia to canvas to JPEG. There is deliberately no file picker. */
function CameraCapture({ shot, onShot }: { shot: Shot | null; onShot: (s: Shot | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"idle" | "starting" | "live" | "error">("idle");
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
      setMessage("This browser can't open the camera. Try Safari or Chrome over HTTPS.");
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
      setState("error");
      setMessage(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Camera access was blocked. Allow it in your browser settings, then try again."
          : "Couldn't start the camera.",
      );
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
      <div className="relative aspect-[4/5] overflow-hidden rounded-[16px] bg-surface-2">
        <video
          ref={video}
          playsInline
          muted
          className={`absolute inset-0 size-full object-cover ${state === "live" ? "opacity-100" : "opacity-0"}`}
        />
        {shot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.url} alt="Your photo" className="absolute inset-0 size-full object-cover" />
        )}
        {!shot && state !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <Camera size={36} weight="regular" className="text-muted" />
            <p className="max-w-[30ch] text-[14px] leading-relaxed text-muted">
              {state === "error"
                ? message
                : state === "starting"
                  ? "Opening camera"
                  : "Photos must be taken live in A-eye, so the agent knows they're from right now."}
            </p>
          </div>
        )}
        <AnimatePresence>
          {flash > 0 && !reduce && (
            <motion.div
              key={flash}
              className="pointer-events-none absolute inset-0 bg-white"
              initial={{ opacity: 0.85 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
            />
          )}
        </AnimatePresence>
      </div>
      <div className="mt-3 flex gap-2">
        {shot ? (
          <button type="button" onClick={retake} className="btn btn-ghost">
            <ArrowCounterClockwise size={16} weight="bold" /> Retake
          </button>
        ) : state === "live" ? (
          <button type="button" onClick={capture} className="btn btn-primary">
            <Camera size={18} weight="bold" /> Take photo
          </button>
        ) : (
          <button type="button" onClick={start} disabled={state === "starting"} className="btn btn-ghost">
            <Camera size={18} weight="bold" /> {state === "error" ? "Try again" : "Open camera"}
          </button>
        )}
      </div>
    </div>
  );
}

function Done({ q, distance }: { q: Question; distance: number }) {
  const reduce = useReducedMotion();
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-60px)] max-w-[560px] flex-col justify-center px-4 py-12">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
      >
        <Ticket size={40} weight="duotone" className="text-accent" />
        <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight">You&apos;re in the raffle.</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-muted">
          Your answer was verified {formatDistance(distance)} from the spot. When the question closes, one verified answer is drawn
          to win {Math.round(q.prize_amount * (1 - PLATFORM_FEE) * 100) / 100} {q.currency}.
        </p>
        <div className="mt-8 flex flex-wrap gap-2">
          <Link href={`/q/${q.id}`} className="btn btn-primary">
            See results <ArrowRight size={16} weight="bold" />
          </Link>
          <Link href="/me" className="btn btn-ghost">
            Set payout wallet
          </Link>
        </div>
      </motion.div>
    </main>
  );
}
