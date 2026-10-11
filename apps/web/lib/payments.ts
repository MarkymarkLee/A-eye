import { toBaseUnits, winnerPayout } from "@a-eye/shared";
import { explorerTxUrl, isTreasuryConfigured, transferAusd, treasuryAddress } from "./chain";

/** Address question bounties are paid to; x402 is enabled for `POST /api/questions` when this resolves. */
export function questionPayTo(): string | undefined {
  return process.env.A_EYE_TREASURY_ADDRESS || treasuryAddress();
}

export const paymentsEnabled = () => Boolean(questionPayTo());

export const prizeUnits = (prizeUsd: number) => toBaseUnits(prizeUsd);

export const winnerPayoutUnits = (prizeUsd: number) => winnerPayout(prizeUnits(prizeUsd));

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
  try {
    const tx = await transferAusd(to, amountUnits);
    console.info(`[payments] ${kind} ${amountUnits} AUSD units to ${to}: ${explorerTxUrl(tx)}`);
    return tx;
  } catch (err) {
    console.error(`[payments] ${kind} to ${to} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
