import { convertStringToHex, xrpToDrops } from "xrpl";
import type {
  EscrowCreate,
  EscrowFinish,
  LoanBrokerCoverDeposit,
  LoanBrokerSet,
  LoanDelete,
  LoanPay,
  LoanSet,
  VaultCreate,
  VaultDeposit,
  VaultWithdraw,
} from "xrpl";

export const XRPL_DEVNET_WSS = "wss://s.devnet.rippletest.net:51233";
export const LENDING_AMENDMENTS = ["SingleAssetVault", "LendingProtocol", "LendingProtocolV1_1"] as const;

export const DEMO_TERMS = {
  depositXrp: "40",
  coverXrp: "5",
  principalXrp: "20",
  bountyPotXrp: "5",
  interestRate: 100000,
  closeInterestRate: 50000,
  managementFeeRate: 10000,
  coverRateMinimum: 10000,
  coverRateLiquidation: 10000,
  paymentTotal: 1,
  paymentIntervalSec: 120,
  gracePeriodSec: 60,
  originationFeeDrops: "100000",
  serviceFeeDrops: "10000",
  subscriptionLeadSec: 45,
  termSec: 240,
} as const;

export function devnetTx(hash: string): string {
  return `https://devnet.xrpl.org/transactions/${hash}`;
}

export function devnetAccount(address: string): string {
  return `https://devnet.xrpl.org/accounts/${address}`;
}

export function buildVaultCreate(broker: string, sub: number, red: number): VaultCreate {
  return {
    TransactionType: "VaultCreate",
    Account: broker,
    Asset: { currency: "XRP" },
    VaultKind: 1,
    SubscriptionDate: sub,
    RedemptionDate: red,
    Data: convertStringToHex("A-eye Bounty Credit Vault"),
  };
}

export function buildLoanBrokerSet(broker: string, vaultId: string): LoanBrokerSet {
  return {
    TransactionType: "LoanBrokerSet",
    Account: broker,
    VaultID: vaultId,
    ManagementFeeRate: DEMO_TERMS.managementFeeRate,
    CoverRateMinimum: DEMO_TERMS.coverRateMinimum,
    CoverRateLiquidation: DEMO_TERMS.coverRateLiquidation,
  };
}

export function buildCoverDeposit(broker: string, lbId: string): LoanBrokerCoverDeposit {
  return {
    TransactionType: "LoanBrokerCoverDeposit",
    Account: broker,
    LoanBrokerID: lbId,
    Amount: xrpToDrops(DEMO_TERMS.coverXrp),
  };
}

export function buildVaultDeposit(dep: string, vaultId: string): VaultDeposit {
  return {
    TransactionType: "VaultDeposit",
    Account: dep,
    VaultID: vaultId,
    Amount: xrpToDrops(DEMO_TERMS.depositXrp),
  };
}

export function buildLoanSet(broker: string, borrower: string, lbId: string): LoanSet {
  return {
    TransactionType: "LoanSet",
    Account: broker,
    Counterparty: borrower,
    LoanBrokerID: lbId,
    PrincipalRequested: xrpToDrops(DEMO_TERMS.principalXrp),
    InterestRate: DEMO_TERMS.interestRate,
    CloseInterestRate: DEMO_TERMS.closeInterestRate,
    PaymentTotal: DEMO_TERMS.paymentTotal,
    PaymentInterval: DEMO_TERMS.paymentIntervalSec,
    GracePeriod: DEMO_TERMS.gracePeriodSec,
    LoanOriginationFee: DEMO_TERMS.originationFeeDrops,
    LoanServiceFee: DEMO_TERMS.serviceFeeDrops,
  };
}

export function buildBountyEscrow(borrower: string, observer: string, finishAfter: number): EscrowCreate {
  return {
    TransactionType: "EscrowCreate",
    Account: borrower,
    Destination: observer,
    Amount: xrpToDrops(DEMO_TERMS.bountyPotXrp),
    FinishAfter: finishAfter,
    CancelAfter: finishAfter + 3600,
  };
}

export function buildEscrowFinish(observer: string, borrower: string, sequence: number): EscrowFinish {
  return {
    TransactionType: "EscrowFinish",
    Account: observer,
    Owner: borrower,
    OfferSequence: sequence,
  };
}

export function buildLoanPay(borrower: string, loanId: string, drops: string): LoanPay {
  return { TransactionType: "LoanPay", Account: borrower, LoanID: loanId, Amount: drops };
}

export function buildLoanDelete(borrower: string, loanId: string): LoanDelete {
  return { TransactionType: "LoanDelete", Account: borrower, LoanID: loanId };
}

export function buildVaultWithdraw(dep: string, vaultId: string, mptId: string, value: string): VaultWithdraw {
  return {
    TransactionType: "VaultWithdraw",
    Account: dep,
    VaultID: vaultId,
    Amount: { mpt_issuance_id: mptId, value },
  };
}

export function loanPayDrops(loan: { PeriodicPayment: string; LoanServiceFee?: string }): string {
  const periodic = Number(loan.PeriodicPayment);
  const serviceFee = Number(loan.LoanServiceFee ?? "0");
  if (!Number.isFinite(periodic) || !Number.isFinite(serviceFee) || periodic < 0 || serviceFee < 0) {
    throw new Error("invalid_loan_payment");
  }
  return (BigInt(Math.floor(periodic)) + BigInt(Math.floor(serviceFee)) + 2n).toString();
}

export function sharePrice(assetsTotalDrops: string, sharesOutstanding: string): number {
  const shares = Number(sharesOutstanding);
  if (shares === 0) return 1;
  return Number(assetsTotalDrops) / shares;
}

export function projectedInterestDrops(terms = DEMO_TERMS): number {
  const principalDrops = Number(xrpToDrops(terms.principalXrp));
  return (principalDrops * (terms.interestRate / 100000) * terms.paymentIntervalSec) / 31_536_000;
}

export type VaultStepKey =
  | "vault_create"
  | "broker_set"
  | "cover_deposit"
  | "vault_deposit"
  | "loan_set"
  | "bounty_pot"
  | "bounty_paid"
  | "loan_pay"
  | "loan_delete"
  | "vault_withdraw";
export type VaultRole = "broker" | "depositor" | "borrower" | "observer";
export type VaultStep = {
  key: VaultStepKey;
  role: VaultRole;
  tx_type: string;
  label: string;
  hash: string | null;
  amount_drops: string | null;
  at: string | null;
};
export type VaultRun = {
  network: "devnet";
  ran_at: string;
  vault_id: string;
  share_mpt_id: string;
  loan_broker_id: string;
  loan_id: string;
  accounts: Record<VaultRole, string>;
  subscription_date: string;
  redemption_date: string;
  principal_drops: string;
  interest_paid_drops: string;
  assets_total_before_repay_drops: string;
  assets_total_after_repay_drops: string;
  shares_outstanding: string;
  depositor_deposit_drops: string;
  depositor_withdraw_drops: string;
  steps: VaultStep[];
};
export type VaultLoanView = {
  loan_id: string | null;
  borrower: string | null;
  principal_drops: string;
  outstanding_drops: string;
  apr_pct: number;
  term_sec: number;
  status: "open" | "repaid";
  explorer_url: string | null;
};
export type VaultView = {
  source: "live" | "recorded" | "simulated";
  network: "devnet";
  vault_id: string | null;
  vault_explorer_url: string | null;
  tvl_drops: string;
  available_drops: string;
  shares_outstanding: string;
  share_price: number;
  phase: "subscription" | "investment" | "redemption";
  subscription_date: string | null;
  redemption_date: string | null;
  depositor_yield_drops: string;
  loans: VaultLoanView[];
  steps: (VaultStep & { explorer_url: string | null })[];
  accounts: Partial<Record<VaultRole, string>>;
};

const STEP_KEYS: readonly VaultStepKey[] = [
  "vault_create",
  "broker_set",
  "cover_deposit",
  "vault_deposit",
  "loan_set",
  "bounty_pot",
  "bounty_paid",
  "loan_pay",
  "loan_delete",
  "vault_withdraw",
];
const ROLES: readonly VaultRole[] = ["broker", "depositor", "borrower", "observer"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isVaultRun(value: unknown): value is VaultRun {
  if (!isRecord(value) || value.network !== "devnet") return false;
  const stringKeys = [
    "ran_at",
    "vault_id",
    "share_mpt_id",
    "loan_broker_id",
    "loan_id",
    "subscription_date",
    "redemption_date",
    "principal_drops",
    "interest_paid_drops",
    "assets_total_before_repay_drops",
    "assets_total_after_repay_drops",
    "shares_outstanding",
    "depositor_deposit_drops",
    "depositor_withdraw_drops",
  ] as const;
  if (!stringKeys.every((key) => typeof value[key] === "string")) return false;
  if (
    !isIsoDate(value.ran_at) ||
    !isIsoDate(value.subscription_date) ||
    !isIsoDate(value.redemption_date)
  ) {
    return false;
  }
  const dropsKeys = [
    "principal_drops",
    "interest_paid_drops",
    "assets_total_before_repay_drops",
    "assets_total_after_repay_drops",
    "shares_outstanding",
    "depositor_deposit_drops",
    "depositor_withdraw_drops",
  ] as const;
  if (!dropsKeys.every((key) => /^\d+$/.test(value[key] as string))) return false;
  const accounts = value.accounts;
  if (!isRecord(accounts) || !ROLES.every((role) => typeof accounts[role] === "string")) return false;
  if (!Array.isArray(value.steps)) return false;
  return value.steps.every((step) => {
    if (!isRecord(step)) return false;
    return (
      STEP_KEYS.includes(step.key as VaultStepKey) &&
      ROLES.includes(step.role as VaultRole) &&
      typeof step.tx_type === "string" &&
      typeof step.label === "string" &&
      isStringOrNull(step.hash) &&
      isStringOrNull(step.amount_drops) &&
      isStringOrNull(step.at) &&
      (step.amount_drops === null || /^\d+$/.test(step.amount_drops)) &&
      (step.at === null || isIsoDate(step.at))
    );
  });
}

function phaseAt(run: VaultRun, closeTimeIso?: string): VaultView["phase"] {
  const parsedCloseTime = closeTimeIso ? Date.parse(closeTimeIso) : Number.NaN;
  const now = Number.isFinite(parsedCloseTime) ? parsedCloseTime : Date.now();
  const subscription = Date.parse(run.subscription_date);
  const redemption = Date.parse(run.redemption_date);
  if (Number.isFinite(subscription) && now < subscription) return "subscription";
  if (Number.isFinite(redemption) && now < redemption) return "investment";
  return "redemption";
}

function amountToView(value: number): string {
  return String(Math.floor(value));
}

export function vaultViewFromRun(
  run: VaultRun,
  live?: {
    vault?: { AssetsTotal: string; AssetsAvailable: string; shares?: { OutstandingAmount?: string } } | null;
    loan?: { PrincipalOutstanding?: string; TotalValueOutstanding?: string } | null;
    closeTimeIso?: string;
  },
): VaultView {
  const isLive = Boolean(live?.vault);
  const total = isLive ? live!.vault!.AssetsTotal : run.assets_total_after_repay_drops;
  const available = isLive ? live!.vault!.AssetsAvailable : run.assets_total_after_repay_drops;
  const shares = (isLive ? live!.vault!.shares?.OutstandingAmount : undefined) ?? run.shares_outstanding;
  const loanStep = run.steps.find((step) => step.key === "loan_set");
  const open = isLive && Boolean(live?.loan);
  return {
    source: isLive ? "live" : "recorded",
    network: "devnet",
    vault_id: run.vault_id,
    vault_explorer_url: devnetAccount(run.accounts.broker),
    tvl_drops: total,
    available_drops: available,
    shares_outstanding: shares,
    share_price: sharePrice(total, shares),
    phase: phaseAt(run, live?.closeTimeIso),
    subscription_date: run.subscription_date,
    redemption_date: run.redemption_date,
    depositor_yield_drops: (BigInt(run.depositor_withdraw_drops) - BigInt(run.depositor_deposit_drops)).toString(),
    loans: [
      {
        loan_id: run.loan_id,
        borrower: run.accounts.borrower,
        principal_drops: run.principal_drops,
        outstanding_drops: open
          ? live!.loan!.TotalValueOutstanding ?? live!.loan!.PrincipalOutstanding ?? "0"
          : "0",
        apr_pct: DEMO_TERMS.interestRate / 1000,
        term_sec: DEMO_TERMS.termSec,
        status: open ? "open" : "repaid",
        explorer_url: loanStep?.hash ? devnetTx(loanStep.hash) : null,
      },
    ],
    steps: run.steps.map((step) => ({
      ...step,
      explorer_url: step.hash ? devnetTx(step.hash) : null,
    })),
    accounts: { ...run.accounts },
  };
}

export function simulatedVaultView(): VaultView {
  const depositDrops = Number(xrpToDrops(DEMO_TERMS.depositXrp));
  const grossInterest = projectedInterestDrops();
  const netInterest = grossInterest * (1 - DEMO_TERMS.managementFeeRate / 100000);
  const tvl = amountToView(depositDrops + netInterest);
  const steps: VaultStep[] = [
    ["vault_create", "broker", "VaultCreate", "Create a closed-ended XRP vault", null],
    ["broker_set", "broker", "LoanBrokerSet", "Configure A-eye as loan broker", null],
    ["cover_deposit", "broker", "LoanBrokerCoverDeposit", "Post loan-broker cover", xrpToDrops(DEMO_TERMS.coverXrp)],
    ["vault_deposit", "depositor", "VaultDeposit", "Deposit XRP and receive vault shares", xrpToDrops(DEMO_TERMS.depositXrp)],
    ["loan_set", "broker", "LoanSet", "Create a counterparty-signed XRP loan", xrpToDrops(DEMO_TERMS.principalXrp)],
    ["bounty_pot", "borrower", "EscrowCreate", "Escrow the observer bounty pot", xrpToDrops(DEMO_TERMS.bountyPotXrp)],
    ["bounty_paid", "observer", "EscrowFinish", "Release the bounty to the human observer", xrpToDrops(DEMO_TERMS.bountyPotXrp)],
    ["loan_pay", "borrower", "LoanPay", "Repay principal, interest, and service fee", null],
    ["loan_delete", "borrower", "LoanDelete", "Close the repaid loan", null],
    ["vault_withdraw", "depositor", "VaultWithdraw", "Redeem shares with yield at maturity", tvl],
  ].map(([key, role, tx_type, label, amount_drops]) => ({
    key: key as VaultStepKey,
    role: role as VaultRole,
    tx_type: tx_type as string,
    label: label as string,
    hash: null,
    amount_drops: amount_drops as string | null,
    at: null,
  }));
  return {
    source: "simulated",
    network: "devnet",
    vault_id: null,
    vault_explorer_url: null,
    tvl_drops: tvl,
    available_drops: tvl,
    shares_outstanding: String(depositDrops),
    share_price: sharePrice(tvl, String(depositDrops)),
    phase: "subscription",
    subscription_date: null,
    redemption_date: null,
    depositor_yield_drops: amountToView(netInterest),
    loans: [
      {
        loan_id: null,
        borrower: null,
        principal_drops: xrpToDrops(DEMO_TERMS.principalXrp),
        outstanding_drops: xrpToDrops(DEMO_TERMS.principalXrp),
        apr_pct: DEMO_TERMS.interestRate / 1000,
        term_sec: DEMO_TERMS.termSec,
        status: "open",
        explorer_url: null,
      },
    ],
    steps: steps.map((step) => ({ ...step, explorer_url: null })),
    accounts: {},
  };
}
