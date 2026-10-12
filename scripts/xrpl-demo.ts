import { existsSync } from "node:fs";
import { Client, Wallet } from "xrpl";
import {
  XRPL_TESTNET_WSS,
  XrplError,
  acceptObserverCredential,
  buildObserverOnboardingBatch,
  createPotEscrow,
  ensureReputationIssuance,
  explorerTx,
  feeDestination,
  issueObserverCredential,
  mintReputation,
  observerLedgerStatus,
  potXrpForUsdQuoted,
  settlePotBatch,
  submitBatch,
} from "../apps/web/lib/xrpl.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printTx(label: string, result: { hash: string; explorer_url?: string }): void {
  console.log(`${label}: ${result.hash} ${result.explorer_url ?? explorerTx(result.hash)}`);
}

async function waitForValidatedCloseTime(finishAfter: Date): Promise<void> {
  const client = new Client(process.env.XRPL_WSS_URL ?? XRPL_TESTNET_WSS);
  await client.connect();
  try {
    const deadline = Date.now() + 3 * 60_000;
    while (Date.now() < deadline) {
      const response = await client.request({
        command: "ledger",
        ledger_index: "validated",
        transactions: false,
      });
      const ledger = response.result.ledger as { close_time_iso?: string };
      if (ledger.close_time_iso && Date.parse(ledger.close_time_iso) > finishAfter.getTime()) return;
      await delay(1_000);
    }
    throw new Error("validated_ledger_timeout");
  } finally {
    await client.disconnect();
  }
}

function requiredSeed(name: string): Wallet {
  const seed = process.env[name];
  if (!seed) throw new XrplError("not_configured");
  return Wallet.fromSeed(seed);
}

async function main(): Promise<void> {
  const envFile = `${process.cwd()}/.env.xrpl.local`;
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const observer = requiredSeed("XRPL_TEST_OBSERVER_SEED");
  requiredSeed("XRPL_TREASURY_SEED");
  requiredSeed("XRPL_ISSUER_SEED");

  // 1. Reputation MPT issuance (created once by the issuer).
  const issuanceId = await ensureReputationIssuance();
  console.log(`Reputation MPT issuance: ${issuanceId} https://testnet.xrpl.org/mpt/${issuanceId}`);

  // 2. Observer onboarding Batch: RLUSD trust line + MPT opt-in, all-or-nothing.
  const status = await observerLedgerStatus(observer.address, issuanceId);
  if (status.rlusd.trustline && status.reputation.opted_in) {
    console.log("Observer onboarding Batch: already onboarded (skipped)");
  } else {
    const client = new Client(process.env.XRPL_WSS_URL ?? XRPL_TESTNET_WSS);
    await client.connect();
    try {
      const onboarding = buildObserverOnboardingBatch(observer.address, issuanceId);
      const result =
        onboarding.TransactionType === "Batch"
          ? await submitBatch(client, observer, onboarding)
          : { batch: undefined, inner: [] };
      if (result.batch) {
        printTx("Observer onboarding Batch", result.batch);
        for (const inner of result.inner) console.log(`  ${inner.type}: ${inner.hash} -> ${inner.result}`);
      } else {
        const res = await client.submitAndWait(onboarding, { autofill: true, wallet: observer });
        console.log(`Observer TrustSet: ${res.result.hash} ${explorerTx(res.result.hash)}`);
      }
    } finally {
      await client.disconnect();
    }
  }

  // 3. Pot escrow sized by the live AMM quote for a $1 prize.
  const potXrp = await potXrpForUsdQuoted(1);
  const finishAfter = new Date(Date.now() + 15_000);
  const escrow = await createPotEscrow(potXrp, finishAfter);
  console.log(`Pot escrow (${potXrp} XRP gross): ${escrow.hash} ${escrow.explorer_url}`);

  // 4. Atomic settlement: EscrowFinish + RLUSD-via-AMM payout + fee, one Batch.
  await waitForValidatedCloseTime(finishAfter);
  const feeDrops = Math.floor(Number(escrow.amount_drops) * 0.1);
  const settled = await settlePotBatch({
    owner: escrow.owner,
    offerSequence: escrow.offer_sequence,
    winner: observer.address,
    rlusdValue: "0.9",
    feeDrops,
    feeDestination: feeDestination(),
  });
  printTx("Settlement Batch", settled.batch);
  console.log(`  EscrowFinish: ${settled.finish.hash} ${settled.finish.explorer_url}`);
  console.log(`  Payout (${settled.payout_amount} ${settled.payout_currency}): ${settled.payout.hash} ${settled.payout.explorer_url}`);
  if (settled.fee) console.log(`  Fee: ${settled.fee.hash} ${settled.fee.explorer_url}`);

  // 5. Mint 3 AEYE reputation points to the observer.
  const minted = await mintReputation(issuanceId, [{ address: observer.address, amount: 3 }]);
  for (const grant of minted) {
    console.log(`Reputation mint x${grant.amount}: ${grant.hash ?? "n/a"} -> ${grant.result}`);
  }

  // 6. Verified Observer credential, issued by the platform and accepted by the observer.
  const credential = await issueObserverCredential(observer.address);
  if (credential.hash && credential.explorer_url) {
    printTx("Observer credential create", credential);
  } else {
    console.log("Observer credential create: already issued");
  }
  try {
    printTx("Observer credential accept", await acceptObserverCredential(observer));
  } catch (error) {
    if (error instanceof XrplError && error.code === "tecDUPLICATE") {
      console.log("Observer credential accept: already accepted");
    } else {
      throw error;
    }
  }

  // Final balances.
  const finalStatus = await observerLedgerStatus(observer.address, issuanceId);
  console.log(`Observer RLUSD balance: ${finalStatus.rlusd.balance ?? "0"}`);
  console.log(`Observer AEYE balance: ${finalStatus.reputation.balance ?? "0"}`);
}

main().catch((error: unknown) => {
  const message = error instanceof XrplError ? error.code : error instanceof Error ? error.message : "demo_failed";
  console.error(`XRPL demo failed: ${message.replace(/[^A-Za-z0-9_:-]/g, "_")}`);
  process.exitCode = 1;
});
