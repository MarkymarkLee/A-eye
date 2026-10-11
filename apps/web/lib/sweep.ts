import "server-only";
import { settleDue } from "./store";

type SweepState = {
  interval: ReturnType<typeof setInterval>;
  running: boolean;
};

const globalSweep = globalThis as typeof globalThis & { __aeyeSweep?: SweepState };

export function startSettlementSweep(intervalMs = Number(process.env.A_EYE_SETTLE_SWEEP_MS ?? 30_000)): boolean {
  if (
    globalSweep.__aeyeSweep ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0 ||
    process.env.NEXT_PHASE === "phase-production-build"
  ) {
    return false;
  }

  const state = { interval: undefined as unknown as ReturnType<typeof setInterval>, running: false };
  state.interval = setInterval(async () => {
    if (state.running) return;
    state.running = true;
    try {
      const settled = await settleDue();
      if (settled > 0) console.info(`[sweep] settled ${settled}`);
    } catch (err) {
      console.error("[sweep] settlement failed:", err);
    } finally {
      state.running = false;
    }
  }, intervalMs);
  state.interval.unref();
  globalSweep.__aeyeSweep = state;
  return true;
}

export function stopSettlementSweep() {
  if (!globalSweep.__aeyeSweep) return;
  clearInterval(globalSweep.__aeyeSweep.interval);
  delete globalSweep.__aeyeSweep;
}
