/** Celebration burst. canvas-confetti is loaded on demand so it never lands in the first-load bundle. */
export async function celebrate() {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { default: confetti } = await import("canvas-confetti");
  const colors = ["#ff5b1f", "#ff3d6e", "#2f7cf6", "#ffd166", "#4ccb8a"];
  const base = { colors, ticks: 220, scalar: 1.05, disableForReducedMotion: true } as const;
  confetti({ ...base, particleCount: 90, spread: 75, startVelocity: 48, origin: { y: 0.65 } });
  setTimeout(() => confetti({ ...base, particleCount: 50, angle: 60, spread: 60, origin: { x: 0, y: 0.75 } }), 180);
  setTimeout(() => confetti({ ...base, particleCount: 50, angle: 120, spread: 60, origin: { x: 1, y: 0.75 } }), 300);
}
