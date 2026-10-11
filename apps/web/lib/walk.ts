/** Plain-language distance helpers for people on foot. */
export function walkMinutes(m: number) {
  return Math.max(1, Math.round(m / 80));
}

export function walkHint(m: number) {
  if (m < 1000) return `${Math.round(m)} m · ${walkMinutes(m)} min walk`;
  return `${(m / 1000).toFixed(1)} km · ${walkMinutes(m)} min walk`;
}

export function directionsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}
