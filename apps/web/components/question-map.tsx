"use client";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { QuestionSummary } from "@a-eye/shared";
import type { Fix } from "@/hooks/use-location";
import { useDark } from "@/hooks/use-dark";

// Worker is copied to /public by scripts/copy-maplibre-worker.mjs (see predev/prebuild).
maplibregl.setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);

const STYLES = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};

type Props = {
  center: { lat: number; lng: number };
  questions: QuestionSummary[];
  fix?: Fix;
  selectedId?: string;
  onSelect: (id: string) => void;
};

export function QuestionMap({ center, questions, fix, selectedId, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const me = useRef<maplibregl.Marker | null>(null);
  const dark = useDark();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: el.current,
        style: dark ? STYLES.dark : STYLES.light,
        center: [center.lng, center.lat],
        zoom: 15,
        attributionControl: { compact: true },
      });
    } catch {
      // No WebGL2 (old devices, some headless browsers): fall back to list only.
      setFailed(true);
      return;
    }
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      markers.current.clear();
      me.current = null;
    };
    // Center is only the initial view; later moves go through flyTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setStyle(dark ? STYLES.dark : STYLES.light);
  }, [dark]);

  // Question pins: prize pill, accent when open, muted when closed.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const q of questions) {
      seen.add(q.id);
      let marker = markers.current.get(q.id);
      if (!marker) {
        const node = document.createElement("button");
        node.type = "button";
        node.addEventListener("click", () => onSelect(q.id));
        marker = new maplibregl.Marker({ element: node, anchor: "bottom" }).setLngLat([q.lng, q.lat]).addTo(m);
        markers.current.set(q.id, marker);
      }
      const node = marker.getElement();
      const open = q.status === "open";
      const selected = q.id === selectedId;
      node.setAttribute("aria-label", `${q.prompt} ${q.prize_amount} ${q.currency}`);
      node.textContent = open ? `${q.prize_amount} ${q.currency}` : "Results";
      node.className = [
        "rounded-full px-2.5 py-1 text-[12px] font-semibold font-mono shadow-panel transition-transform",
        open ? "bg-accent text-on-accent" : "bg-surface text-muted ring-1 ring-line",
        selected ? "scale-110 ring-2 ring-ink" : "",
      ].join(" ");
      node.style.zIndex = selected ? "2" : open ? "1" : "0";
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
  }, [questions, selectedId, onSelect]);

  // Your position: a real live indicator, not decoration.
  useEffect(() => {
    const m = map.current;
    if (!m || !fix) return;
    if (!me.current) {
      const dot = document.createElement("div");
      dot.className = "size-4 rounded-full bg-[#2f7cf6] ring-4 ring-[#2f7cf6]/25 border-2 border-white";
      dot.setAttribute("aria-label", "Your location");
      me.current = new maplibregl.Marker({ element: dot }).setLngLat([fix.lng, fix.lat]).addTo(m);
      m.jumpTo({ center: [fix.lng, fix.lat] });
    } else {
      me.current.setLngLat([fix.lng, fix.lat]);
    }
  }, [fix]);

  useEffect(() => {
    const q = questions.find((x) => x.id === selectedId);
    if (q && map.current) map.current.flyTo({ center: [q.lng, q.lat], zoom: Math.max(map.current.getZoom(), 15.5), speed: 1.4 });
  }, [selectedId, questions]);

  if (failed) {
    return (
      <div className="flex size-full items-center justify-center bg-surface-2 px-8 text-center text-[14px] text-muted">
        This browser can&apos;t draw the map (WebGL is off). The list still works.
      </div>
    );
  }
  return <div ref={el} className="size-full" role="region" aria-label="Map of nearby questions" />;
}
