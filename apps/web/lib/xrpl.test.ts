import { describe, expect, it, vi } from "vitest";
import { decodeMPTokenMetadata } from "xrpl";
import type { Client, Payment, TxResponse } from "xrpl";
import {
  CREDENTIAL_TYPE_HEX,
  RLUSD_TESTNET,
  XrplError,
  buildBatch,
  buildCredentialAccept,
  buildCredentialCreate,
  buildEscrowCancel,
  buildEscrowCreate,
  buildEscrowFinish,
  buildMptAuthorize,
  buildObserverOnboardingBatch,
  buildReputationIssuanceCreate,
  buildRlusdAmmPayment,
  buildRlusdPayment,
  buildTrustSet,
  credentialCreateOutcome,
  explorerTx,
  hasRlusdTrustLine,
  submitBatch,
  unixTimestampToRippleTime,
} from "./xrpl.js";

const TREASURY = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const SUBJECT = "rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH";

describe("XRPL builders", () => {
  it("builds an RLUSD payment and trust set with the testnet issue", () => {
    expect(buildRlusdPayment(TREASURY, SUBJECT, "1.25")).toMatchObject({
      TransactionType: "Payment",
      Account: TREASURY,
      Destination: SUBJECT,
      Amount: { currency: RLUSD_TESTNET.currency, issuer: RLUSD_TESTNET.issuer, value: "1.25" },
    });
    expect(buildTrustSet(SUBJECT, "1000000")).toMatchObject({
      TransactionType: "TrustSet",
      LimitAmount: { currency: RLUSD_TESTNET.currency, issuer: RLUSD_TESTNET.issuer, value: "1000000" },
    });
  });

  it("builds XRP escrows with Ripple-time fields and the requested destination", () => {
    const finishAfter = new Date("2026-10-11T20:00:00.000Z");
    const cancelAfter = new Date("2026-10-18T20:00:00.000Z");
    expect(buildEscrowCreate(TREASURY, "2", finishAfter, { destination: SUBJECT, cancelAfter })).toMatchObject({
      TransactionType: "EscrowCreate",
      Account: TREASURY,
      Destination: SUBJECT,
      Amount: "2000000",
      FinishAfter: 845_064_000,
    });
    expect(buildEscrowFinish(TREASURY, TREASURY, 12)).toMatchObject({
      TransactionType: "EscrowFinish",
      Owner: TREASURY,
      OfferSequence: 12,
    });
    expect(buildEscrowCancel(TREASURY, TREASURY, 12)).toMatchObject({
      TransactionType: "EscrowCancel",
      Owner: TREASURY,
      OfferSequence: 12,
    });
  });

  it("builds issuer credentials and observer acceptance", () => {
    expect(
      buildCredentialCreate(TREASURY, SUBJECT, {
        uri: "https://a-eye.example/observers/1",
        expiration: new Date("2026-10-11T20:00:00.000Z"),
      }),
    ).toMatchObject({
      TransactionType: "CredentialCreate",
      Account: TREASURY,
      Subject: SUBJECT,
      CredentialType: CREDENTIAL_TYPE_HEX,
      URI: "68747470733A2F2F612D6579652E6578616D706C652F6F62736572766572732F31",
      Expiration: 845_064_000,
    });
    expect(buildCredentialAccept(SUBJECT, TREASURY)).toMatchObject({
      TransactionType: "CredentialAccept",
      Account: SUBJECT,
      Issuer: TREASURY,
      CredentialType: CREDENTIAL_TYPE_HEX,
    });
  });

  it("rejects invalid addresses and amounts", () => {
    expect(() => buildRlusdPayment("not-an-address", SUBJECT, "1")).toThrow(XrplError);
    expect(() => buildTrustSet(SUBJECT, "0")).toThrow(/invalid_amount/);
    expect(() => buildRlusdPayment(TREASURY, SUBJECT, "1.0000001")).toThrow(/invalid_amount/);
    expect(() => buildRlusdPayment(TREASURY, SUBJECT, "1234567890123456")).toThrow(/invalid_amount/);
    expect(() => buildEscrowFinish(TREASURY, TREASURY, -1)).toThrow(/invalid_sequence/);
  });
});

describe("XRPL Batch and MPT builders", () => {
  const INNER_FLAG = 0x40000000; // GlobalFlags.tfInnerBatchTxn

  const innerPayment = (account: string): Payment => ({
    TransactionType: "Payment",
    Account: account,
    Destination: SUBJECT,
    Amount: "1000",
  });

  it("sets tfInnerBatchTxn on every inner and the right mode flag", () => {
    const batch = buildBatch(TREASURY, [innerPayment(TREASURY), innerPayment(TREASURY)], "allOrNothing");
    expect(batch.Flags).toBe(65536); // BatchFlags.tfAllOrNothing
    expect(batch.RawTransactions).toHaveLength(2);
    for (const raw of batch.RawTransactions) {
      expect(Number(raw.RawTransaction.Flags) & INNER_FLAG).toBe(INNER_FLAG);
    }
    const independent = buildBatch(TREASURY, [innerPayment(TREASURY), innerPayment(TREASURY)], "independent");
    expect(independent.Flags).toBe(524288); // BatchFlags.tfIndependent
  });

  it("preserves existing inner flags and rejects bad batches", () => {
    const flagged = { ...innerPayment(TREASURY), Flags: 131072 };
    const batch = buildBatch(TREASURY, [flagged, innerPayment(TREASURY)], "allOrNothing");
    expect(Number(batch.RawTransactions[0]!.RawTransaction.Flags)).toBe(131072 | INNER_FLAG);
    expect(() => buildBatch(TREASURY, [innerPayment(TREASURY)], "allOrNothing")).toThrow(/invalid_batch/);
    expect(() =>
      buildBatch(TREASURY, Array.from({ length: 9 }, () => innerPayment(TREASURY)), "allOrNothing"),
    ).toThrow(/invalid_batch/);
    expect(() => buildBatch(TREASURY, [innerPayment(TREASURY), innerPayment(SUBJECT)], "allOrNothing")).toThrow(
      /invalid_batch/,
    );
  });

  it("builds an RLUSD AMM payment with SendMax in drops and no partial-payment flag", () => {
    expect(buildRlusdAmmPayment(TREASURY, SUBJECT, "0.9", "18000000")).toEqual({
      TransactionType: "Payment",
      Account: TREASURY,
      Destination: SUBJECT,
      Amount: { currency: RLUSD_TESTNET.currency, issuer: RLUSD_TESTNET.issuer, value: "0.9" },
      SendMax: "18000000",
    });
    expect(() => buildRlusdAmmPayment(TREASURY, SUBJECT, "0.9", "0")).toThrow(/invalid_amount/);
  });

  it("builds the observer onboarding batch, or a bare TrustSet without an issuance", () => {
    const issuance = "000004C463C52827307480341125DA0577DEFC38405B0E3E";
    const batch = buildObserverOnboardingBatch(SUBJECT, issuance);
    expect(batch.TransactionType).toBe("Batch");
    if (batch.TransactionType !== "Batch") return;
    expect(batch.RawTransactions.map((r) => r.RawTransaction.TransactionType)).toEqual([
      "TrustSet",
      "MPTokenAuthorize",
    ]);
    expect(buildObserverOnboardingBatch(SUBJECT)).toMatchObject({ TransactionType: "TrustSet" });
    expect(buildMptAuthorize(SUBJECT, issuance)).toMatchObject({
      TransactionType: "MPTokenAuthorize",
      MPTokenIssuanceID: issuance,
    });
  });

  it("issues a non-transferable AEYE reputation MPT with XLS-89 metadata", () => {
    const create = buildReputationIssuanceCreate(TREASURY);
    expect(create.TransactionType).toBe("MPTokenIssuanceCreate");
    expect(create.AssetScale).toBe(0);
    expect(Number(create.Flags ?? 0) & 32).toBe(0); // no tfMPTCanTransfer
    expect(decodeMPTokenMetadata(create.MPTokenMetadata!)).toMatchObject({
      ticker: "AEYE",
      name: "A-eye Verified Answers",
      asset_class: "other",
      issuer_name: "A-eye",
    });
  });
});

describe("submitBatch", () => {
  const signedInner = (account: string) => ({
    TransactionType: "Payment" as const,
    Account: account,
    Destination: SUBJECT,
    Amount: "1000",
    Fee: "0",
    Sequence: 1,
    SigningPubKey: "",
    Flags: 0x40000000,
  });

  const batchResponse = (inner: unknown[]): TxResponse =>
    ({
      result: {
        hash: "A".repeat(64),
        ledger_index: 42,
        meta: { TransactionResult: "tesSUCCESS" },
        tx_json: { TransactionType: "Batch", RawTransactions: inner.map((t) => ({ RawTransaction: t })) },
      },
    }) as unknown as TxResponse;

  it("reports each inner transaction's real result", async () => {
    const inners = [signedInner(TREASURY), signedInner(TREASURY)];
    const request = vi
      .fn()
      .mockResolvedValueOnce({ result: { meta: { TransactionResult: "tesSUCCESS" } } })
      .mockResolvedValueOnce({ result: { meta: { TransactionResult: "tecNO_AUTH" } } });
    const client = {
      submitAndWait: vi.fn().mockResolvedValue(batchResponse(inners)),
      request,
    } as unknown as Client;
    const batch = buildBatch(TREASURY, inners.map((t) => ({ ...t })), "allOrNothing");
    const result = await submitBatch(client, {} as never, batch);
    expect(result.inner).toHaveLength(2);
    expect(result.inner[0]!.result).toBe("tesSUCCESS");
    expect(result.inner[1]!.result).toBe("tecNO_AUTH");
    expect(result.inner[0]!.hash).toMatch(/^[0-9A-F]{64}$/);
  });

  it("maps an outer tem* failure to batch_unavailable", async () => {
    const client = {
      submitAndWait: vi.fn().mockRejectedValue({ data: { engine_result: "temDISABLED" } }),
    } as unknown as Client;
    const batch = buildBatch(TREASURY, [signedInner(TREASURY), signedInner(TREASURY)], "allOrNothing");
    await expect(submitBatch(client, {} as never, batch)).rejects.toThrow(/batch_unavailable:temDISABLED/);
  });
});

describe("XRPL helpers", () => {
  it("converts Unix milliseconds to Ripple epoch seconds", () => {
    expect(unixTimestampToRippleTime(Date.parse("2000-01-01T00:00:00.000Z"))).toBe(0);
    expect(unixTimestampToRippleTime(Date.parse("2026-10-11T20:00:00.000Z"))).toBe(845_064_000);
  });

  it("detects an RLUSD trust line and rejects unrelated lines", () => {
    expect(
      hasRlusdTrustLine([{ account: RLUSD_TESTNET.issuer, currency: RLUSD_TESTNET.currency }]),
    ).toBe(true);
    expect(hasRlusdTrustLine([{ account: SUBJECT, currency: RLUSD_TESTNET.currency }])).toBe(false);
    expect(hasRlusdTrustLine([{ account: RLUSD_TESTNET.issuer, currency: "USD" }])).toBe(false);
    expect(hasRlusdTrustLine([])).toBe(false);
  });

  it("maps duplicate observer credentials to an already-issued result", () => {
    expect(
      credentialCreateOutcome("tecDUPLICATE", {
        hash: "ABC",
        explorer_url: explorerTx("ABC"),
        ledger_index: 100,
      }),
    ).toEqual({ hash: null, explorer_url: null, ledger_index: null, already_issued: true });
    expect(() =>
      credentialCreateOutcome("tecNO_PERMISSION", {
        hash: "ABC",
        explorer_url: explorerTx("ABC"),
        ledger_index: 100,
      }),
    ).toThrow(/tecNO_PERMISSION/);
  });
});
