import { AUSD, PLATFORM_FEE_BPS } from "./constants.js";

export function toBaseUnits(amount: string | number, decimals: number = AUSD.decimals): bigint {
  const str = typeof amount === "number" ? amount.toFixed(decimals) : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(str)) throw new Error(`Invalid amount: ${amount}`);
  const [whole, frac = ""] = str.split(".");
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) {
    throw new Error(`Amount ${amount} has more than ${decimals} decimals`);
  }
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(frac.slice(0, decimals).padEnd(decimals, "0"));
}

export function fromBaseUnits(units: bigint, decimals: number = AUSD.decimals): string {
  const base = 10n ** BigInt(decimals);
  const frac = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${units / base}.${frac}` : `${units / base}`;
}

export function winnerPayout(prizeUnits: bigint, feeBps: number = PLATFORM_FEE_BPS): bigint {
  return (prizeUnits * BigInt(10_000 - feeBps)) / 10_000n;
}
