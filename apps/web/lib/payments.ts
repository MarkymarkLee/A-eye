import { toBaseUnits, winnerPayout } from "@a-eye/shared";
import {
  ausdTxStatus,
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

export const winnerPayoutUnits = (prizeUsd: number) => winnerPayout(prizeUnits(prizeUsd));

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

export type TreasuryTransfer =
  | { status: "confirmed"; tx: string }
  | { status: "skipped"; reason: "treasury_not_configured" | "no_recipient" | "zero_amount" }
  | { status: "failed"; error: string } // nothing mined; safe to sign a new tx
  | { status: "unconfirmed"; tx: string; error: string };

/**
 * Ledger-backed variant of sendFromTreasury: reports exactly what happened so the
 * caller can persist retries. `onSigned` runs before broadcast (persist the hash+raw
 * there). Never throws.
 */
export async function transferFromTreasury(
  kind: "payout" | "refund",
  to: string | null | undefined,
  amountUnits: bigint,
  onSigned?: (tx: { hash: `0x${string}`; raw: `0x${string}` }) => void,
): Promise<TreasuryTransfer> {
  if (!to) return { status: "skipped", reason: "no_recipient" };
  if (amountUnits <= BigInt(0)) return { status: "skipped", reason: "zero_amount" };
  if (!isTreasuryConfigured()) return { status: "skipped", reason: "treasury_not_configured" };
  let signedHash: `0x${string}` | undefined;
  try {
    const tx = await transferAusd(to, amountUnits, {
      onSigned: ({ hash, raw }) => {
        signedHash = hash;
        onSigned?.({ hash, raw });
      },
    });
    console.info(`[payments] ${kind} ${amountUnits} AUSD units to ${to}: ${explorerTxUrl(tx)}`);
    return { status: "confirmed", tx };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!signedHash) {
      console.error(`[payments] ${kind} to ${to} failed:`, message);
      return { status: "failed", error: message };
    }
    // Signed but the outcome is unknown: it may or may not have been broadcast/mined.
    try {
      const status = await ausdTxStatus(signedHash);
      if (status === "success") return { status: "confirmed", tx: signedHash };
      if (status === "reverted") return { status: "failed", error: message };
    } catch {
      // Can't tell either; treat as unconfirmed.
    }
    console.error(`[payments] ${kind} to ${to} unconfirmed (${signedHash}):`, message);
    return { status: "unconfirmed", tx: signedHash, error: message };
  }
}
