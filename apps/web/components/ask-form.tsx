"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Crosshair, Minus, Plus } from "@phosphor-icons/react";

type Created = { question_id: string; gallery_url: string; seed_commit: string };

export function AskForm({ initial }: { initial?: { lat: number; lng: number } }) {
  const [coords, setCoords] = useState(initial);
  const [locating, setLocating] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["Yes", "No"]);
  const [place, setPlace] = useState("");
  const [radius, setRadius] = useState(150);
  const [prize, setPrize] = useState(1);
  const [minimum, setMinimum] = useState(1);
  const [minutes, setMinutes] = useState(30);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  function locate() {
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCoords({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => {
        setError("Couldn't read your location. Allow location access and try again.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!coords) return setError("Set a location first.");
    setSending(true);
    setError(null);
    const res = await fetch("/api/questions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lat: coords.lat,
        lng: coords.lng,
        question,
        options: options.map((o) => o.trim()).filter(Boolean),
        place_label: place || undefined,
        radius_m: radius,
        prize_usd: prize,
        min_responses: minimum,
        closes_in_minutes: minutes,
        allow_free_text: true,
      }),
    });
    const json = await res.json();
    setSending(false);
    if (!res.ok) {
      setError(json.issues?.[0]?.message ? `${json.issues[0].path.join(".")}: ${json.issues[0].message}` : json.error);
      return;
    }
    setCreated(json);
  }

  if (created) {
    return (
      <div className="mt-8 rounded-[16px] bg-surface p-6 ring-1 ring-line">
        <p className="text-xl font-semibold tracking-tight">Question is live.</p>
        <p className="mt-1 text-[14px] text-muted">This is what an agent gets back:</p>
        <pre className="mt-4 overflow-x-auto rounded-[12px] bg-[#0f1216] p-4 font-mono text-[12.5px] leading-relaxed text-[#d6dae0]">
          {JSON.stringify(created, null, 2)}
        </pre>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={`/q/${created.question_id}/answer`} className="btn btn-primary">
            Answer it <ArrowRight size={16} weight="bold" />
          </Link>
          <Link href={`/q/${created.question_id}`} className="btn btn-ghost">
            Results page
          </Link>
          <button type="button" className="btn btn-ghost" onClick={() => setCreated(null)}>
            Ask another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 grid gap-6">
      <div className="grid gap-2">
        <span className="text-[14px] font-medium">Location</span>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={locate} disabled={locating} className="btn btn-ghost">
            <Crosshair size={16} weight="bold" /> {locating ? "Locating" : coords ? "Update to my location" : "Use my location"}
          </button>
          <span className="font-mono text-[13px] text-muted">
            {coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : "Not set"}
          </span>
        </div>
      </div>

      <div className="grid gap-2">
        <label htmlFor="q" className="text-[14px] font-medium">
          Question
        </label>
        <input
          id="q"
          required
          minLength={4}
          maxLength={240}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="field"
          placeholder="Is the food truck by the north gate open?"
        />
      </div>

      <div className="grid gap-2">
        <span className="text-[14px] font-medium">Answers</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input
                aria-label={`Answer ${i + 1}`}
                required
                maxLength={60}
                value={o}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
                className="field"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  aria-label={`Remove answer ${i + 1}`}
                  onClick={() => setOptions(options.filter((_, j) => j !== i))}
                  className="btn btn-ghost !px-3"
                >
                  <Minus size={16} weight="bold" />
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < 6 && (
          <button type="button" onClick={() => setOptions([...options, ""])} className="btn btn-ghost justify-self-start !py-2 text-[14px]">
            <Plus size={14} weight="bold" /> Add answer
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Num id="place" label="Place name" value={place} onText={setPlace} />
        <Num id="radius" label="Radius (m)" value={radius} onNum={setRadius} min={25} max={2000} />
        <Num id="prize" label="Pot (AUSD)" value={prize} onNum={setPrize} min={0.1} max={500} step={0.1} />
        <Num id="min" label="Min answers" value={minimum} onNum={setMinimum} min={1} max={100} />
        <Num id="mins" label="Closes in (min)" value={minutes} onNum={setMinutes} min={1} max={1440} />
      </div>

      {error && (
        <p role="alert" className="text-[14px] text-bad">
          {error}
        </p>
      )}

      <button type="submit" disabled={sending || !coords} className="btn btn-primary justify-self-start">
        {sending ? "Posting" : "Post question"} {!sending && <ArrowRight size={16} weight="bold" />}
      </button>
    </form>
  );
}

function Num(props: {
  id: string;
  label: string;
  value: string | number;
  onNum?: (n: number) => void;
  onText?: (s: string) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={props.id} className="text-[14px] font-medium">
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.onNum ? "number" : "text"}
        inputMode={props.onNum ? "decimal" : undefined}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => (props.onNum ? props.onNum(Number(e.target.value)) : props.onText?.(e.target.value))}
        className="field"
      />
    </div>
  );
}
