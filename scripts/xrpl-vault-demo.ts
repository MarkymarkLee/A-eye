import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Client,
  Wallet,
  decode,
  signLoanSetByCounterparty,
  xrpToDrops,
} from "xrpl";
import type { VaultRun, VaultRole, VaultStep, VaultStepKey } from "../apps/web/lib/xrpl-lending.ts";
import {
  DEMO_TERMS,
  LENDING_AMENDMENTS,
  XRPL_DEVNET_WSS,
  buildBountyEscrow,
  buildCoverDeposit,
  buildEscrowFinish,
  buildLoanBrokerSet,
  buildLoanDelete,
  buildLoanPay,
  buildLoanSet,
  buildVaultCreate,
  buildVaultDeposit,
  buildVaultWithdraw,
  devnetAccount,
  devnetTx,
  loanPayDrops,
  simulatedVaultView,
} from "../apps/web/lib/xrpl-lending.ts";

const ENV_FILE = resolve(process.cwd(), ".env.xrpl.local");
const SNAPSHOT_FILE = resolve(process.cwd(), "apps/web/data/xrpl-vault-run.json");
const ROLE_ENV_KEYS = {
  broker: "XRPL_VAULT_BROKER_SEED",
  depositor: "XRPL_VAULT_DEPOSITOR_SEED",
  sponsor: "XRPL_VAULT_SPONSOR_SEED",
  borrower: "XRPL_VAULT_BORROWER_SEED",
  observer: "XRPL_VAULT_OBSERVER_SEED",
} as const satisfies Record<VaultRole, string>;

type TxReceipt = {
  result: {
    hash: string;
    meta: unknown;
    tx_json?: { Sequence?: number; Fee?: string };
  };
};
type ValidatedLedger = { close_time?: number; close_time_iso?: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function transactionResult(receipt: TxReceipt): string | null {
  const meta = asRecord(receipt.result.meta);
  return typeof meta?.TransactionResult === "string" ? meta.TransactionResult : null;
}

function ensureSuccess(step: string, receipt: TxReceipt): void {
  const code = transactionResult(receipt);
  if (code !== "tesSUCCESS") throw new Error(`${step}: ${code ?? "submit_failed"}`);
}

function metadataObject(metaValue: unknown): Record<string, unknown> | null {
  if (typeof metaValue === "string") {
    try {
      return asRecord(JSON.parse(metaValue) as unknown);
    } catch {
      return null;
    }
  }
  return asRecord(metaValue);
}

function createdLedgerIndex(receipt: TxReceipt, type: string): string {
  const affected = metadataObject(receipt.result.meta)?.AffectedNodes;
  if (!Array.isArray(affected)) throw new Error(`missing_${type.toLowerCase()}_created_node`);
  for (const affectedNode of affected) {
    const change = asRecord(affectedNode);
    const created = asRecord(change?.CreatedNode);
    if (created?.LedgerEntryType === type && typeof created.LedgerIndex === "string") return created.LedgerIndex;
  }
  throw new Error(`missing_${type.toLowerCase()}_created_node`);
}

function saveWalletSeeds(wallets: Record<VaultRole, Wallet>): void {
  const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const replacedKeys = new Set(Object.values(ROLE_ENV_KEYS));
  const preserved = existing
    .split(/\r?\n/)
    .filter((line) => {
      const key = line.slice(0, line.indexOf("="));
      return line.includes("=") && !replacedKeys.has(key as (typeof ROLE_ENV_KEYS)[VaultRole]);
    });
  const newLines = (Object.keys(ROLE_ENV_KEYS) as VaultRole[]).map((role) => {
    const seed = wallets[role].seed;
    if (!seed) throw new Error("wallet_seed_missing");
    return `${ROLE_ENV_KEYS[role]}=${seed}`;
  });
  const content = [...preserved, ...newLines].filter(Boolean).join("\n") + "\n";
  writeFileSync(ENV_FILE, content, { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
}

function rippleDate(rippleTime: number): string {
  return new Date((rippleTime + 946_684_800) * 1000).toISOString();
}

async function validatedLedger(client: Client): Promise<ValidatedLedger> {
  const response = await client.request({
    command: "ledger",
    ledger_index: "validated",
    transactions: false,
  });
  return response.result.ledger as ValidatedLedger;
}

async function waitUntilValidatedTime(client: Client, target: number): Promise<ValidatedLedger> {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const ledger = await validatedLedger(client);
    if (typeof ledger.close_time === "number" && ledger.close_time > target) return ledger;
    await sleep(1000);
  }
  throw new Error("validated_ledger_timeout");
}

async function accountBalanceDrops(client: Client, address: string): Promise<bigint> {
  const response = await client.request({ command: "account_info", account: address, ledger_index: "validated" });
  const accountData = response.result.account_data as { Balance: string };
  return BigInt(accountData.Balance);
}

function receivedDropsFromMeta(receipt: TxReceipt, destination: string): string | null {
  const meta = metadataObject(receipt.result.meta);
  const affected = meta?.AffectedNodes;
  if (!Array.isArray(affected)) return null;
  for (const affectedNode of affected) {
    const change = asRecord(affectedNode);
    const node = asRecord(change?.ModifiedNode) ?? asRecord(change?.CreatedNode);
    if (node?.LedgerEntryType !== "AccountRoot") continue;
    const finalFields = asRecord(node.FinalFields) ?? asRecord(node.NewFields);
    const previousFields = asRecord(node.PreviousFields);
    if (finalFields?.Account !== destination || typeof finalFields.Balance !== "string") continue;
    const before = typeof previousFields?.Balance === "string" ? BigInt(previousFields.Balance) : 0n;
    const fee = BigInt(receipt.result.tx_json?.Fee ?? "0");
    return (BigInt(finalFields.Balance) - before + fee).toString();
  }
  return null;
}

function recordStep(
  steps: VaultStep[],
  role: VaultRole,
  key: VaultStepKey,
  txType: string,
  label: string,
  receipt: TxReceipt,
  amountDrops: string | null = null,
): void {
  const hash = receipt.result.hash;
  steps.push({
    key,
    role,
    tx_type: txType,
    label,
    hash,
    amount_drops: amountDrops,
    at: new Date().toISOString(),
  });
  console.log(`${role} ${key} ${hash} ${devnetTx(hash)}`);
}

function printDryRun(): void {
  console.log("XRPL Devnet lending amendments unavailable; dry run only.");
  for (const step of simulatedVaultView().steps) {
    console.log(`DRY RUN ${step.role} ${step.key}: ${step.label}`);
  }
}

function enabledAmendments(result: unknown): string[] {
  const root = asRecord(result);
  const features = asRecord(root?.features) ?? root;
  return LENDING_AMENDMENTS.filter((amendment) => {
    const feature = asRecord(features?.[amendment]);
    if (feature?.enabled === true) return true;
    return Object.values(features ?? {}).some((entry) => {
      const value = asRecord(entry);
      return value?.name === amendment && value.enabled === true;
    });
  });
}

async function main(): Promise<void> {
  const client = new Client(process.env.XRPL_LENDING_WSS ?? XRPL_DEVNET_WSS);
  try {
    try {
      await client.connect();
    } catch {
      printDryRun();
      return;
    }

    let featureResponse: unknown;
    try {
      featureResponse = (await client.request({ command: "feature" })).result;
    } catch {
      printDryRun();
      return;
    }
    const enabled = enabledAmendments(featureResponse);
    if (enabled.length !== LENDING_AMENDMENTS.length) {
      console.log(`Missing enabled amendments: ${LENDING_AMENDMENTS.filter((name) => !enabled.includes(name)).join(", ")}`);
      printDryRun();
      return;
    }

    const wallets: Record<VaultRole, Wallet> = {} as Record<VaultRole, Wallet>;
    for (const role of Object.keys(ROLE_ENV_KEYS) as VaultRole[]) {
      wallets[role] = (await client.fundWallet()).wallet;
    }
    saveWalletSeeds(wallets);
    const accounts = Object.fromEntries(
      (Object.keys(ROLE_ENV_KEYS) as VaultRole[]).map((role) => [role, wallets[role].address]),
    ) as Record<VaultRole, string>;
    const steps: VaultStep[] = [];
    const startLedger = await validatedLedger(client);
    if (typeof startLedger.close_time !== "number") throw new Error("validated_close_time_missing");
    const subscription = startLedger.close_time + DEMO_TERMS.subscriptionLeadSec;
    const redemption = subscription + DEMO_TERMS.termSec;

    const vaultCreate = (await client.submitAndWait(
      await client.autofill(buildVaultCreate(accounts.broker, subscription, redemption)),
      { wallet: wallets.broker },
    )) as unknown as TxReceipt;
    ensureSuccess("vault_create", vaultCreate);
    const vaultId = createdLedgerIndex(vaultCreate, "Vault");
    recordStep(steps, "broker", "vault_create", "VaultCreate", "Create the closed-ended XRP vault", vaultCreate);

    const brokerSet = (await client.submitAndWait(
      buildLoanBrokerSet(accounts.broker, vaultId),
      { autofill: true, wallet: wallets.broker },
    )) as unknown as TxReceipt;
    ensureSuccess("broker_set", brokerSet);
    const loanBrokerId = createdLedgerIndex(brokerSet, "LoanBroker");
    recordStep(steps, "broker", "broker_set", "LoanBrokerSet", "Configure A-eye as loan broker", brokerSet);

    const coverDeposit = (await client.submitAndWait(buildCoverDeposit(accounts.broker, loanBrokerId), {
      autofill: true,
      wallet: wallets.broker,
    })) as unknown as TxReceipt;
    ensureSuccess("cover_deposit", coverDeposit);
    recordStep(
      steps,
      "broker",
      "cover_deposit",
      "LoanBrokerCoverDeposit",
      "Post the loan-broker cover",
      coverDeposit,
      xrpToDrops(DEMO_TERMS.coverXrp),
    );

    const vaultDeposit = (await client.submitAndWait(buildVaultDeposit(accounts.depositor, vaultId), {
      autofill: true,
      wallet: wallets.depositor,
    })) as unknown as TxReceipt;
    ensureSuccess("vault_deposit", vaultDeposit);
    recordStep(
      steps,
      "depositor",
      "vault_deposit",
      "VaultDeposit",
      "Deposit XRP into the vault",
      vaultDeposit,
      xrpToDrops(DEMO_TERMS.depositXrp),
    );

    const sponsorDeposit = (await client.submitAndWait(
      buildVaultDeposit(accounts.sponsor, vaultId, DEMO_TERMS.sponsorDepositXrp),
      { autofill: true, wallet: wallets.sponsor },
    )) as unknown as TxReceipt;
    ensureSuccess("sponsor_deposit", sponsorDeposit);
    recordStep(
      steps,
      "sponsor",
      "sponsor_deposit",
      "VaultDeposit",
      "Keep sponsor XRP invested in the vault",
      sponsorDeposit,
      xrpToDrops(DEMO_TERMS.sponsorDepositXrp),
    );

    await waitUntilValidatedTime(client, subscription);

    const loanSetTx = await client.autofill(buildLoanSet(accounts.broker, accounts.borrower, loanBrokerId));
    const brokerSignedLoan = wallets.broker.sign(loanSetTx);
    const counterpartyLoan = signLoanSetByCounterparty(wallets.borrower, decode(brokerSignedLoan.tx_blob));
    const loanSet = (await client.submitAndWait(counterpartyLoan.tx)) as unknown as TxReceipt;
    ensureSuccess("loan_set", loanSet);
    const loanId = createdLedgerIndex(loanSet, "Loan");
    recordStep(
      steps,
      "broker",
      "loan_set",
      "LoanSet",
      "Create the borrower's XRP loan",
      loanSet,
      xrpToDrops(DEMO_TERMS.principalXrp),
    );

    const vaultResponse = await client.request({ command: "vault_info", vault_id: vaultId, ledger_index: "validated" });
    const shareMptId = vaultResponse.result.vault.ShareMPTID;
    const vaultAccount = vaultResponse.result.vault.Account;
    if (typeof vaultAccount !== "string") throw new Error("vault_account_missing");
    const assetsBeforeRepay = vaultResponse.result.vault.AssetsTotal ?? "0";
    const sharesOutstanding = vaultResponse.result.vault.shares.OutstandingAmount;
    const loanResponse = await client.request({
      command: "ledger_entry",
      index: loanId,
      ledger_index: "validated",
    });
    const loan = loanResponse.result.node as { PeriodicPayment: string; LoanServiceFee?: string };

    const bountyLedger = await validatedLedger(client);
    if (typeof bountyLedger.close_time !== "number") throw new Error("validated_close_time_missing");
    const finishAfter = bountyLedger.close_time + 15;
    const escrowCreate = (await client.submitAndWait(
      buildBountyEscrow(accounts.borrower, accounts.observer, finishAfter),
      { autofill: true, wallet: wallets.borrower },
    )) as unknown as TxReceipt;
    ensureSuccess("bounty_pot", escrowCreate);
    const offerSequence = escrowCreate.result.tx_json?.Sequence;
    if (typeof offerSequence !== "number") throw new Error("bounty_pot: missing_escrow_sequence");
    recordStep(
      steps,
      "borrower",
      "bounty_pot",
      "EscrowCreate",
      "Escrow the XRP bounty for the human observer",
      escrowCreate,
      xrpToDrops(DEMO_TERMS.bountyPotXrp),
    );

    await waitUntilValidatedTime(client, finishAfter);
    const escrowFinish = (await client.submitAndWait(
      buildEscrowFinish(accounts.observer, accounts.borrower, offerSequence),
      { autofill: true, wallet: wallets.observer },
    )) as unknown as TxReceipt;
    ensureSuccess("bounty_paid", escrowFinish);
    recordStep(
      steps,
      "observer",
      "bounty_paid",
      "EscrowFinish",
      "Release the bounty to the human observer",
      escrowFinish,
      xrpToDrops(DEMO_TERMS.bountyPotXrp),
    );

    const paymentDrops = loanPayDrops(loan);
    const interestPaid = (
      BigInt(paymentDrops) -
      BigInt(xrpToDrops(DEMO_TERMS.principalXrp)) -
      BigInt(loan.LoanServiceFee ?? "0")
    ).toString();
    const loanPay = (await client.submitAndWait(
      buildLoanPay(accounts.borrower, loanId, paymentDrops),
      { autofill: true, wallet: wallets.borrower },
    )) as unknown as TxReceipt;
    ensureSuccess("loan_pay", loanPay);
    recordStep(steps, "borrower", "loan_pay", "LoanPay", "Repay principal, interest, and service fee", loanPay, paymentDrops);

    const loanDelete = (await client.submitAndWait(buildLoanDelete(accounts.borrower, loanId), {
      autofill: true,
      wallet: wallets.borrower,
    })) as unknown as TxReceipt;
    ensureSuccess("loan_delete", loanDelete);
    recordStep(steps, "borrower", "loan_delete", "LoanDelete", "Close the repaid loan", loanDelete);

    const postRepayVault = await client.request({ command: "vault_info", vault_id: vaultId, ledger_index: "validated" });
    const assetsAfterRepay = postRepayVault.result.vault.AssetsTotal ?? "0";
    await waitUntilValidatedTime(client, redemption);

    const objectsResponse = await client.request({
      command: "account_objects",
      account: accounts.depositor,
      type: "mptoken",
      ledger_index: "validated",
    });
    const shareToken = objectsResponse.result.account_objects.find((object) => {
      const token = object as { LedgerEntryType?: string; MPTokenIssuanceID?: string };
      return token.LedgerEntryType === "MPToken" && token.MPTokenIssuanceID === shareMptId;
    }) as { MPTAmount?: string } | undefined;
    if (!shareToken?.MPTAmount) throw new Error("vault_withdraw: depositor_share_token_missing");

    const balanceBefore = await accountBalanceDrops(client, accounts.depositor);
    const vaultWithdraw = (await client.submitAndWait(
      buildVaultWithdraw(accounts.depositor, vaultId, shareMptId, shareToken.MPTAmount),
      { autofill: true, wallet: wallets.depositor },
    )) as unknown as TxReceipt;
    ensureSuccess("vault_withdraw", vaultWithdraw);
    const metadataReceived = receivedDropsFromMeta(vaultWithdraw, accounts.depositor);
    const balanceAfter = await accountBalanceDrops(client, accounts.depositor);
    const withdrawDrops =
      metadataReceived ?? (balanceAfter - balanceBefore + BigInt(vaultWithdraw.result.tx_json?.Fee ?? "0")).toString();
    recordStep(
      steps,
      "depositor",
      "vault_withdraw",
      "VaultWithdraw",
      "Redeem vault shares at maturity",
      vaultWithdraw,
      withdrawDrops,
    );

    const postWithdrawVault = await client.request({
      command: "vault_info",
      vault_id: vaultId,
      ledger_index: "validated",
    });
    const assetsAfterWithdraw = postWithdrawVault.result.vault.AssetsTotal ?? "0";
    const sharesAfterWithdraw = postWithdrawVault.result.vault.shares.OutstandingAmount ?? "0";

    const run: VaultRun = {
      network: "devnet",
      ran_at: new Date().toISOString(),
      vault_id: vaultId,
      share_mpt_id: shareMptId,
      loan_broker_id: loanBrokerId,
      loan_id: loanId,
      vault_account: vaultAccount,
      accounts,
      subscription_date: rippleDate(subscription),
      redemption_date: rippleDate(redemption),
      principal_drops: xrpToDrops(DEMO_TERMS.principalXrp),
      interest_paid_drops: interestPaid,
      assets_total_before_repay_drops: assetsBeforeRepay,
      assets_total_after_repay_drops: assetsAfterRepay,
      shares_outstanding: sharesOutstanding,
      depositor_deposit_drops: xrpToDrops(DEMO_TERMS.depositXrp),
      depositor_withdraw_drops: withdrawDrops,
      assets_total_after_withdraw_drops: assetsAfterWithdraw,
      shares_after_withdraw: sharesAfterWithdraw,
      steps,
    };
    if (!process.argv.includes("--no-snapshot")) {
      writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(run, null, 2)}\n`);
    }

    const beforePrice = Number(assetsBeforeRepay) / Number(sharesOutstanding);
    const afterPrice = Number(assetsAfterWithdraw) / Number(sharesAfterWithdraw);
    console.log(
      `Summary: deposit=${run.depositor_deposit_drops} drops withdraw=${run.depositor_withdraw_drops} drops yield=${(
        BigInt(run.depositor_withdraw_drops) - BigInt(run.depositor_deposit_drops)
      ).toString()} drops share_price_before=${beforePrice} share_price_after=${afterPrice}`,
    );
    console.log(`Vault: ${vaultId} ${devnetAccount(vaultAccount)}`);
    console.log(`Snapshot: ${process.argv.includes("--no-snapshot") ? "not written (--no-snapshot)" : SNAPSHOT_FILE}`);
  } finally {
    if (client.isConnected()) await client.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "xrpl_vault_demo_failed";
  console.error(`XRPL vault demo failed: ${message}`);
  process.exitCode = 1;
});
