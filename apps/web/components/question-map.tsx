"use client";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { QuestionSummary } from "@a-eye/shared";
import type { Fix } from "@/hooks/use-location";
import { useDark } from "@/hooks/use-dark";
import { formatAmount } from "@/lib/money";

// Worker is copied to /public by scripts/copy-maplibre-worker.mjs (see predev/prebuild).
maplibregl.setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);

const STYLES = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};
const CLUSTER_PX = 46;

type Props = {
  center: { lat: number; lng: number };
  questions: QuestionSummary[];
  fix?: Fix;
  selectedId?: string;
  onSelect: (id: string) => void;
};

/** Groups pins that would overlap at the current zoom (screen-space greedy clustering). */
function cluster(m: maplibregl.Map, qs: QuestionSummary[]) {
  const groups: { lngLat: [number, number]; items: QuestionSummary[]; x: number; y: number }[] = [];
  const sorted = [...qs].sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || b.prize_amount - a.prize_amount);
  for (const q of sorted) {
    const p = m.project([q.lng, q.lat]);
    const g = groups.find((g) => Math.hypot(g.x - p.x, g.y - p.y) < CLUSTER_PX);
    if (g) g.items.push(q);
    else groups.push({ lngLat: [q.lng, q.lat], items: [q], x: p.x, y: p.y });
  }
  return groups;
}

function pinHtml(q: QuestionSummary, selected: boolean) {
  const open = q.status === "open";
  const label = open ? `${formatAmount(q.prize_amount)} ${q.currency}` : "Results";
  return `
    <span class="relative flex flex-col items-center transition-transform duration-300 ${selected ? "scale-115 -translate-y-1" : "hover:-translate-y-0.5"}">
      ${open ? '<span class="absolute bottom-[-6px] size-5 rounded-full bg-accent/40 animate-pulse-ring"></span>' : ""}
      <span class="relative whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold tabular-nums shadow-lift ${
        open ? "bg-accent text-on-accent" : "bg-surface text-muted ring-1 ring-line"
      } ${selected ? "ring-[3px] ring-ink" : ""}">${label}</span>
      <span class="relative -mt-1 size-2.5 rotate-45 ${open ? "bg-accent" : "bg-surface ring-1 ring-line"}"></span>
    </span>`;
}

export function QuestionMap({ center, questions, fix, selectedId, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const me = useRef<maplibregl.Marker | null>(null);
  const latest = useRef({ questions, selectedId, onSelect });
  latest.current = { questions, selectedId, onSelect };
  const dark = useDark();
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const framed = useRef(false);

  const render = () => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    const { questions, selectedId, onSelect } = latest.current;
    for (const g of cluster(m, questions)) {
      const node = document.createElement("button");
      node.type = "button";
      if (g.items.length === 1) {
        const q = g.items[0]!;
        node.innerHTML = pinHtml(q, q.id === selectedId);
        node.setAttribute("aria-label", `${q.prompt}. ${q.status === "open" ? `Prize ${formatAmount(q.prize_amount)} ${q.currency}` : "See results"}`);
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelect(q.id);
        });
        node.style.zIndex = q.id === selectedId ? "3" : q.status === "open" ? "2" : "1";
      } else {
        const open = g.items.filter((q) => q.status === "open").length;
        node.innerHTML = `
          <span class="relative grid size-12 place-items-center rounded-full ${open ? "bg-accent text-on-accent" : "bg-surface text-ink ring-1 ring-line"} text-[15px] font-bold shadow-lift transition-transform hover:scale-105">
            ${open ? '<span class="absolute inset-0 rounded-full bg-accent/40 animate-pulse-ring"></span>' : ""}
            <span class="relative">${g.items.length}</span>
          </span>`;
        node.setAttribute("aria-label", `${g.items.length} questions here. Zoom in.`);
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          const b = new maplibregl.LngLatBounds();
          g.items.forEach((q) => b.extend([q.lng, q.lat]));
          m.fitBounds(b, { padding: 80, maxZoom: 18, duration: 600 });
        });
        node.style.zIndex = "2";
      }
      node.className = "rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent";
      markers.current.push(
        new maplibregl.Marker({ element: node, anchor: g.items.length === 1 ? "bottom" : "center" }).setLngLat(g.lngLat).addTo(m),
      );
    }
  };

  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: el.current,
        style: document.documentElement.dataset.theme === "dark" ? STYLES.dark : STYLES.light,
        center: [center.lng, center.lat],
        zoom: 14.6,
        attributionControl: { compact: true },
      });
    } catch {
      // No WebGL2 (old devices, some headless browsers): fall back to list only.
      setFailed(true);
      return;
    }
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => setReady(true));
    m.on("zoomend", render);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      markers.current = [];
      me.current = null;
    };
    // Center is only the initial view; later moves go through flyTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setStyle(dark ? STYLES.dark : STYLES.light);
  }, [dark]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(render, [questions, selectedId, ready]);

  // First view: frame you and the open questions together so every pin is on screen.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || framed.current || !questions.length) return;
    const pts = questions.filter((q) => q.status === "open");
    const b = new maplibregl.LngLatBounds();
    for (const q of pts.length ? pts : questions) b.extend([q.lng, q.lat]);
    if (fix) b.extend([fix.lng, fix.lat]);
    framed.current = true;
    m.fitBounds(b, { padding: { top: 90, bottom: 50, left: 50, right: 70 }, maxZoom: 16.5, duration: 700 });
  }, [ready, questions, fix]);

  // Your position: a live, pulsing indicator with an accuracy halo.
  useEffect(() => {
    const m = map.current;
    if (!m || !fix) return;
    if (!me.current) {
      const dot = document.createElement("div");
      dot.innerHTML = `
        <span class="relative grid size-5 place-items-center">
          <span class="absolute size-5 rounded-full bg-sky/40 animate-pulse-ring"></span>
          <span class="relative size-4 rounded-full border-[3px] border-white bg-sky shadow-lift"></span>
        </span>`;
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", "You are here");
      me.current = new maplibregl.Marker({ element: dot }).setLngLat([fix.lng, fix.lat]).addTo(m);
      if (!framed.current) m.easeTo({ center: [fix.lng, fix.lat], duration: 800 });
    } else {
      me.current.setLngLat([fix.lng, fix.lat]);
    }
  }, [fix]);

  useEffect(() => {
    const q = questions.find((x) => x.id === selectedId);
    if (q && map.current) map.current.flyTo({ center: [q.lng, q.lat], zoom: Math.max(map.current.getZoom(), 15.5), speed: 1.2, offset: [0, -40] });
  }, [selectedId, questions]);

  if (failed) {
    return (
      <div className="flex size-full items-center justify-center bg-surface-2 px-8 text-center text-[14px] text-muted">
        Your browser can&apos;t draw the map here. The list below still works.
      </div>
    );
  }
  return (
    <div className="relative size-full">
      <div ref={el} className="size-full" role="region" aria-label="Map of nearby questions" />
      {!ready && <div className="skeleton absolute inset-0" aria-hidden />}
    </div>
  );
}
