/** Short vibration patterns. No-ops where the Vibration API is missing (iOS Safari) or motion is reduced. */
const PATTERNS = {
  tap: 8,
  select: [6, 30, 6],
  success: [12, 60, 24, 40, 40],
  error: [40, 40, 40],
} satisfies Record<string, number | number[]>;

export type Haptic = keyof typeof PATTERNS;

export function haptic(kind: Haptic = "tap") {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  // Chrome blocks vibrate() (with a console error) until the user has interacted.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Some browsers throw when vibration is blocked by a permissions policy.
  }
}
