export function timeLeft(closesAt: string, now = Date.now()) {
  const ms = Date.parse(closesAt) - now;
  if (ms <= 0) return "closed";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "<1 min left";
  if (min < 60) return `${min} min left`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min left`;
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}
