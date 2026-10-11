import { PLATFORM_FEE, toBaseUnits } from "@a-eye/shared";
import {
  explorerTxUrl,
  isTreasuryConfigured,
  transferAusd,
  transferAusdViaFacilitator,
  treasuryAddress,
} from "./chain";

/** Address question bounties are paid to; x402 is enabled for `POST /api/questions` when this resolves. */
export function questionPayTo(): string | undefined {
  return process.env.A_EYE_TREASURY_ADDRESS || treasuryAddress();
}

export const paymentsEnabled = () => Boolean(questionPayTo());

export const prizeUnits = (prizeUsd: number) => toBaseUnits(prizeUsd);

export const winnerPayoutUnits = (prizeUsd: number) =>
  prizeUnits(Math.round(prizeUsd * (1 - PLATFORM_FEE) * 100) / 100);

export const peekPriceUnits = () => {
  const price = Number(process.env.A_EYE_PEEK_PRICE_USD ?? 0.02);
  return prizeUnits(Number.isFinite(price) && price >= 0 ? price : 0.02);
};

export const peekPaywallActive = () =>
  Boolean(questionPayTo()) && process.env.ALLOW_UNPAID_QUESTIONS !== "1" && peekPriceUnits() > 0n;

/**
 * Send AUSD from the treasury, never throwing: settlement must still complete when the
 * treasury is unconfigured, unfunded, or the RPC is down. Returns the tx hash or null.
 */
export async function sendFromTreasury(
  kind: "payout" | "refund",
  to: string | null | undefined,
  amountUnits: bigint,
): Promise<string | null> {
  if (!to || amountUnits <= BigInt(0)) return null;
  if (!isTreasuryConfigured()) {
    console.warn(`[payments] ${kind} to ${to} skipped: A_EYE_TREASURY_PRIVATE_KEY is not set`);
    return null;
  }
  if (process.env.A_EYE_PAYOUT_RAIL !== "direct") {
    try {
      const tx = await transferAusdViaFacilitator(to, amountUnits);
      console.info(`[payments] ${kind} via facilitator ${amountUnits} AUSD units to ${to}: ${explorerTxUrl(tx)}`);
      return tx;
    } catch (err) {
      console.error(`[payments] ${kind} facilitator rail to ${to} failed:`, err instanceof Error ? err.message : err);
    }
  }
  try {
    const tx = await transferAusd(to, amountUnits);
    console.info(`[payments] ${kind} via direct rail ${amountUnits} AUSD units to ${to}: ${explorerTxUrl(tx)}`);
    return tx;
  } catch (err) {
    console.error(`[payments] ${kind} direct rail to ${to} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
