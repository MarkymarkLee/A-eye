/** Shared motion presets so every surface moves with the same physics. */
export const ease = [0.16, 1, 0.3, 1] as const;

export const spring = {
  soft: { type: "spring", stiffness: 140, damping: 22 },
  snappy: { type: "spring", stiffness: 420, damping: 30 },
  bouncy: { type: "spring", stiffness: 300, damping: 16 },
} as const;

export const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
};

export const stagger = (step = 0.05, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: delay } },
});
