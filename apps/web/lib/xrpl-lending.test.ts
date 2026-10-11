import { afterEach, describe, expect, it, vi } from "vitest";
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
  isVaultRun,
  loanPayDrops,
  projectedInterestDrops,
  sharePrice,
  simulatedVaultView,
  vaultViewFromRun,
  type VaultRun,
} from "./xrpl-lending.js";

vi.mock("server-only", () => ({}));

const run: VaultRun = {
  network: "devnet",
  ran_at: "2026-10-11T20:00:00.000Z",
  vault_id: "A".repeat(64),
  share_mpt_id: "B".repeat(64),
  loan_broker_id: "C".repeat(64),
  loan_id: "D".repeat(64),
  accounts: {
    broker: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    depositor: "rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH",
    borrower: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
    observer: "rJ1h2r9W1e3B5D8zK7cA4pQ6sT9vX3mN",
  },
  subscription_date: "2026-10-11T20:00:45.000Z",
  redemption_date: "2026-10-11T20:04:45.000Z",
  principal_drops: "20000000",
  interest_paid_drops: "78",
  assets_total_before_repay_drops: "40000000",
  assets_total_after_repay_drops: "40000070",
  shares_outstanding: "40000000",
  depositor_deposit_drops: "40000000",
  depositor_withdraw_drops: "40000070",
  steps: [
    {
      key: "loan_set",
      role: "broker",
      tx_type: "LoanSet",
      label: "Create the borrower's XRP loan",
      hash: "TXHASH",
      amount_drops: "20000000",
      at: "2026-10-11T20:01:00.000Z",
    },
  ],
};

afterEach(() => vi.unstubAllEnvs());

describe("XRPL lending transaction builders", () => {
  it("builds the closed-ended XRP vault and broker setup", () => {
    expect(buildVaultCreate("broker", 100, 340)).toMatchObject({
      TransactionType: "VaultCreate",
      Account: "broker",
      Asset: { currency: "XRP" },
      VaultKind: 1,
      SubscriptionDate: 100,
      RedemptionDate: 340,
      Data: "412D65796520426F756E747920437265646974205661756C74",
    });
    expect(buildLoanBrokerSet("broker", "VAULT")).toMatchObject({
      TransactionType: "LoanBrokerSet",
      Account: "broker",
      VaultID: "VAULT",
      ManagementFeeRate: 10000,
      CoverRateMinimum: 10000,
      CoverRateLiquidation: 10000,
    });
    expect(buildCoverDeposit("broker", "BROKER")).toMatchObject({
      TransactionType: "LoanBrokerCoverDeposit",
      Amount: "5000000",
    });
    expect(buildVaultDeposit("depositor", "VAULT")).toMatchObject({
      TransactionType: "VaultDeposit",
      Amount: "40000000",
    });
  });

  it("builds the loan, observer escrow, repayment, close, and share withdrawal", () => {
    expect(buildLoanSet("broker", "borrower", "BROKER")).toMatchObject({
      TransactionType: "LoanSet",
      Account: "broker",
      Counterparty: "borrower",
      LoanBrokerID: "BROKER",
      PrincipalRequested: "20000000",
      InterestRate: 100000,
      CloseInterestRate: 50000,
      PaymentTotal: 1,
      PaymentInterval: 120,
      GracePeriod: 60,
      LoanOriginationFee: "100000",
      LoanServiceFee: "10000",
    });
    expect(buildBountyEscrow("borrower", "observer", 200)).toMatchObject({
      TransactionType: "EscrowCreate",
      Account: "borrower",
      Destination: "observer",
      Amount: "5000000",
      FinishAfter: 200,
      CancelAfter: 3800,
    });
    expect(buildEscrowFinish("observer", "borrower", 22)).toMatchObject({
      TransactionType: "EscrowFinish",
      Account: "observer",
      Owner: "borrower",
      OfferSequence: 22,
    });
    expect(buildLoanPay("borrower", "LOAN", "20010078")).toMatchObject({
      TransactionType: "LoanPay",
      LoanID: "LOAN",
      Amount: "20010078",
    });
    expect(buildLoanDelete("borrower", "LOAN")).toMatchObject({ TransactionType: "LoanDelete", LoanID: "LOAN" });
    expect(buildVaultWithdraw("depositor", "VAULT", "MPT", "40000000").Amount).toEqual({
      mpt_issuance_id: "MPT",
      value: "40000000",
    });
  });

  it("provides the Devnet constants and amount projections", () => {
    expect(XRPL_DEVNET_WSS).toBe("wss://s.devnet.rippletest.net:51233");
    expect(LENDING_AMENDMENTS).toEqual(["SingleAssetVault", "LendingProtocol", "LendingProtocolV1_1"]);
    expect(DEMO_TERMS.depositXrp).toBe("40");
    expect(devnetTx("HASH")).toBe("https://devnet.xrpl.org/transactions/HASH");
    expect(devnetAccount("rADDRESS")).toBe("https://devnet.xrpl.org/accounts/rADDRESS");
    expect(loanPayDrops({ PeriodicPayment: "20000076.10349944904", LoanServiceFee: "10000" })).toBe("20010078");
    expect(sharePrice("40000070", "40000000")).toBeCloseTo(1.00000175);
    expect(sharePrice("10", "0")).toBe(1);
    expect(projectedInterestDrops()).toBeCloseTo(76.1, 1);
  });
});

describe("XRPL vault views", () => {
  it("guards the recorded snapshot and computes recorded/live values and phases", () => {
    expect(isVaultRun({})).toBe(false);
    expect(isVaultRun(run)).toBe(true);
    expect(isVaultRun({ ...run, principal_drops: "not-drops" })).toBe(false);
    expect(isVaultRun({ ...run, subscription_date: "not-a-date" })).toBe(false);
    expect(vaultViewFromRun(run)).toMatchObject({
      source: "recorded",
      tvl_drops: "40000070",
      available_drops: "40000070",
      share_price: 1.00000175,
      depositor_yield_drops: "70",
      loans: [{ status: "repaid", outstanding_drops: "0" }],
    });
    expect(
      vaultViewFromRun(run, {
        vault: {
          AssetsTotal: "40000070",
          AssetsAvailable: "40000070",
          shares: { OutstandingAmount: "40000000" },
        },
        loan: null,
        closeTimeIso: "2026-10-11T20:05:00.000Z",
      }),
    ).toMatchObject({ source: "live", phase: "redemption", loans: [{ status: "repaid" }] });
    expect(
      vaultViewFromRun(run, { vault: null, loan: null, closeTimeIso: "2026-10-11T20:00:30.000Z" }),
    ).toMatchObject({ source: "recorded", phase: "subscription" });
    expect(
      vaultViewFromRun(run, { vault: null, loan: null, closeTimeIso: "2026-10-11T20:01:00.000Z" }),
    ).toMatchObject({ phase: "investment" });
  });

  it("returns a fully labeled simulation with no transaction hashes", () => {
    const view = simulatedVaultView();
    expect(view).toMatchObject({ source: "simulated", network: "devnet", vault_id: null });
    expect(view.steps).toHaveLength(10);
    expect(view.steps.every((step) => step.hash === null && step.explorer_url === null && step.label.length > 0)).toBe(
      true,
    );
  });

  it("loads the committed snapshot without connecting when live mode is disabled", async () => {
    vi.stubEnv("XRPL_VAULT_LIVE", "0");
    const { loadVaultView } = await import("./xrpl-vault-state.js");
    await expect(loadVaultView()).resolves.toMatchObject({ source: "recorded" });
  });
});
