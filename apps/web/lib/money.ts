/** Exact amount for display: up to 6 decimals, trailing zeros trimmed (0.045, 2, 0.000001). */
export function formatAmount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "0";
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

/** Round to the 6 decimals AUSD and RLUSD carry, dropping float noise (0.1 + 0.2 → 0.3). */
export const roundAmount = (n: number) => Math.round(n * 1e6) / 1e6;
