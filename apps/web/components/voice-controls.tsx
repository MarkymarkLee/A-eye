"use client";
import { useEffect, useRef, useState } from "react";
import { CircleNotch, Microphone, SpeakerHigh, Stop } from "@phosphor-icons/react";

const MAX_RECORDING_MS = 10_000;

/** Reads text aloud through /api/tts (ElevenLabs). Hides itself when the server has no voice key. */
export function ReadAloudButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "unavailable" | "error">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      audio.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    },
    [],
  );

  async function toggle() {
    if (state === "playing") {
      audio.current?.pause();
      setState("idle");
      return;
    }
    if (!audio.current) {
      setState("loading");
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (res.status === 503) return setState("unavailable");
        if (!res.ok) return setState("error");
        audioUrl.current = URL.createObjectURL(await res.blob());
        audio.current = new Audio(audioUrl.current);
        audio.current.onended = () => setState("idle");
      } catch {
        return setState("error");
      }
    }
    audio.current.currentTime = 0;
    try {
      await audio.current.play();
      setState("playing");
    } catch {
      setState("error");
    }
  }

  if (state === "unavailable") return null;
  return (
    <button type="button" onClick={toggle} disabled={state === "loading"} className="btn btn-ghost px-3 py-2 text-[14px]">
      {state === "loading" ? (
        <CircleNotch size={16} weight="bold" className="animate-spin" />
      ) : state === "playing" ? (
        <Stop size={16} weight="bold" />
      ) : (
        <SpeakerHigh size={16} weight="bold" />
      )}
      {state === "playing" ? "Stop" : state === "error" ? "Couldn't play. Retry" : "Read aloud"}
    </button>
  );
}

function recorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
}

/** Records up to 10 s of speech and transcribes it through /api/stt (ElevenLabs Scribe). */
export function SpeakAnswerButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing" | "unavailable">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
    },
    [],
  );

  async function transcribe(blob: Blob) {
    setState("transcribing");
    const body = new FormData();
    body.set("audio", blob, blob.type.includes("mp4") ? "answer.m4a" : "answer.webm");
    try {
      const res = await fetch("/api/stt", { method: "POST", body });
      if (res.status === 503) {
        setState("unavailable");
        return;
      }
      const json = (await res.json().catch(() => null)) as { text?: string } | null;
      if (!res.ok || typeof json?.text !== "string") throw new Error();
      if (json.text.trim()) onTranscript(json.text.trim());
      else setMessage("Didn't catch that. Try again.");
    } catch {
      setMessage("Couldn't transcribe that. Tap an answer instead.");
    }
    setState("idle");
  }

  async function start() {
    setMessage(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("This browser can't record audio.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMessage("Microphone access was blocked.");
      return;
    }
    const mimeType = recorderMimeType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      if (timer.current) clearTimeout(timer.current);
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      void transcribe(new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }));
    };
    recorder.current = rec;
    rec.start();
    setState("recording");
    timer.current = setTimeout(() => rec.state === "recording" && rec.stop(), MAX_RECORDING_MS);
  }

  if (state === "unavailable") return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={() => (state === "recording" ? recorder.current?.stop() : start())}
        disabled={state === "transcribing"}
        aria-pressed={state === "recording"}
        className={`btn px-3 py-2 text-[14px] ${state === "recording" ? "btn-primary" : "btn-ghost"}`}
      >
        {state === "transcribing" ? (
          <CircleNotch size={16} weight="bold" className="animate-spin" />
        ) : state === "recording" ? (
          <Stop size={16} weight="bold" />
        ) : (
          <Microphone size={16} weight="bold" />
        )}
        {state === "recording" ? "Done talking" : state === "transcribing" ? "Listening" : "Say your answer"}
      </button>
      {message && <span className="text-[13px] text-muted">{message}</span>}
    </div>
  );
}
