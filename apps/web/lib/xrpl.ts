import {
  BatchFlags,
  Client,
  GlobalFlags,
  Wallet,
  convertStringToHex,
  dropsToXrp,
  encodeMPTokenMetadata,
  isValidClassicAddress,
  isoTimeToRippleTime,
  xrpToDrops,
} from "xrpl";
import { hashes } from "xrpl";
import type {
  Batch,
  CredentialAccept,
  CredentialCreate,
  EscrowCancel,
  EscrowCreate,
  EscrowFinish,
  IssuedCurrencyAmount,
  MPTokenAuthorize,
  MPTokenIssuanceCreate,
  Payment,
  SubmittableTransaction,
  TrustSet,
  TxResponse,
} from "xrpl";

export const RLUSD_TESTNET = {
  issuer: "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
  currency: "524C555344000000000000000000000000000000",
} as const;
export const XRPL_TESTNET_WSS = "wss://s.altnet.rippletest.net:51233";
export const CREDENTIAL_TYPE_HEX = convertStringToHex("A-eye Verified Observer");
const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800;

export class XrplError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "XrplError";
    this.code = code;
  }
}

export function explorerTx(hash: string): string {
  return `https://testnet.xrpl.org/transactions/${hash}`;
}

export function isXrplConfigured(): boolean {
  return Boolean(process.env.XRPL_TREASURY_SEED && process.env.XRPL_ISSUER_SEED);
}

function assertAddress(address: string): void {
  if (!isValidClassicAddress(address)) throw new XrplError("invalid_address");
}

function amountString(amount: string | number, maxDecimals = 6): string {
  const value = String(amount);
  const match = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[1]?.length ?? 0) > maxDecimals) throw new XrplError("invalid_amount");
  const significantDigits = value.replace(".", "").replace(/^0+/, "");
  if (!significantDigits || significantDigits.length > 15) throw new XrplError("invalid_amount");
  if (Number(value) <= 0) throw new XrplError("invalid_amount");
  return value;
}

function rippleTime(date: Date): number {
  if (!Number.isFinite(date.getTime())) throw new XrplError("invalid_time");
  return isoTimeToRippleTime(date);
}

export function buildRlusdPayment(from: string, to: string, amount: string | number): Payment {
  assertAddress(from);
  assertAddress(to);
  const value = amountString(amount);
  const issuedAmount: IssuedCurrencyAmount = {
    currency: RLUSD_TESTNET.currency,
    issuer: RLUSD_TESTNET.issuer,
    value,
  };
  return { TransactionType: "Payment", Account: from, Destination: to, Amount: issuedAmount };
}

export function buildTrustSet(account: string, limit: string | number): TrustSet {
  assertAddress(account);
  return {
    TransactionType: "TrustSet",
    Account: account,
    LimitAmount: {
      currency: RLUSD_TESTNET.currency,
      issuer: RLUSD_TESTNET.issuer,
      value: amountString(limit),
    },
  };
}

export function buildEscrowCreate(
  account: string,
  amountXrp: string | number,
  finishAfter: Date,
  opts: { destination?: string; cancelAfter?: Date } = {},
): EscrowCreate {
  assertAddress(account);
  if (opts.destination) assertAddress(opts.destination);
  const cancelAfter = opts.cancelAfter ?? new Date(finishAfter.getTime() + 7 * 24 * 60 * 60 * 1000);
  const finishRippleTime = rippleTime(finishAfter);
  const cancelRippleTime = rippleTime(cancelAfter);
  if (cancelRippleTime <= finishRippleTime) throw new XrplError("invalid_time");
  // RLUSD's issuer does not enable trust-line locking, so the pot escrow uses XRP.
  return {
    TransactionType: "EscrowCreate",
    Account: account,
    Destination: opts.destination ?? account,
    Amount: xrpToDrops(amountString(amountXrp)),
    FinishAfter: finishRippleTime,
    CancelAfter: cancelRippleTime,
  };
}

export function buildEscrowFinish(account: string, owner: string, offerSequence: number): EscrowFinish {
  assertAddress(account);
  assertAddress(owner);
  if (!Number.isSafeInteger(offerSequence) || offerSequence < 0) throw new XrplError("invalid_sequence");
  return { TransactionType: "EscrowFinish", Account: account, Owner: owner, OfferSequence: offerSequence };
}

export function buildEscrowCancel(account: string, owner: string, offerSequence: number): EscrowCancel {
  assertAddress(account);
  assertAddress(owner);
  if (!Number.isSafeInteger(offerSequence) || offerSequence < 0) throw new XrplError("invalid_sequence");
  return { TransactionType: "EscrowCancel", Account: account, Owner: owner, OfferSequence: offerSequence };
}

export function buildCredentialCreate(
  issuer: string,
  subject: string,
  opts: { uri?: string; expiration?: Date } = {},
): CredentialCreate {
  assertAddress(issuer);
  assertAddress(subject);
  const transaction: CredentialCreate = {
    TransactionType: "CredentialCreate",
    Account: issuer,
    Subject: subject,
    CredentialType: CREDENTIAL_TYPE_HEX,
  };
  if (opts.uri !== undefined) transaction.URI = convertStringToHex(opts.uri);
  if (opts.expiration !== undefined) {
    transaction.Expiration = rippleTime(opts.expiration);
  }
  return transaction;
}

export function buildCredentialAccept(subject: string, issuer: string): CredentialAccept {
  assertAddress(subject);
  assertAddress(issuer);
  return {
    TransactionType: "CredentialAccept",
    Account: subject,
    Issuer: issuer,
    CredentialType: CREDENTIAL_TYPE_HEX,
  };
}

function walletFromSeed(seed: string | undefined, role: string): Wallet {
  if (!seed) throw new XrplError("not_configured");
  try {
    return Wallet.fromSeed(seed);
  } catch {
    throw new XrplError(`invalid_${role}_seed`);
  }
}

function treasuryWallet(): Wallet {
  return walletFromSeed(process.env.XRPL_TREASURY_SEED, "treasury");
}

function issuerWallet(): Wallet {
  return walletFromSeed(process.env.XRPL_ISSUER_SEED, "issuer");
}

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(process.env.XRPL_WSS_URL ?? XRPL_TESTNET_WSS);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    if (client.isConnected()) await client.disconnect();
  }
}

type SubmitResult = {
  hash: string;
  explorer_url: string;
  ledger_index: number | null;
};

export type CredentialOutcome = {
  hash: string | null;
  explorer_url: string | null;
  ledger_index: number | null;
  already_issued: boolean;
};

function txResultCode(result: TxResponse): string | null {
  const meta = result.result.meta;
  if (typeof meta === "string") {
    try {
      const parsed = JSON.parse(meta) as { TransactionResult?: unknown };
      return typeof parsed.TransactionResult === "string" ? parsed.TransactionResult : null;
    } catch {
      return null;
    }
  }
  const value = meta as { TransactionResult?: unknown } | undefined;
  return typeof value?.TransactionResult === "string" ? value.TransactionResult : null;
}

async function submit(
  client: Client,
  wallet: Wallet,
  transaction: SubmittableTransaction,
  allowDuplicateCredential = false,
): Promise<{ response: TxResponse; resultCode: string }> {
  let response: TxResponse;
  try {
    response = await client.submitAndWait(transaction, { autofill: true, wallet });
  } catch (error) {
    const errorCode =
      typeof error === "object" && error !== null && "data" in error &&
      typeof error.data === "object" && error.data !== null && "error" in error.data
        ? String(error.data.error)
        : "submit_failed";
    throw new XrplError(errorCode);
  }
  const resultCode = txResultCode(response);
  if (resultCode !== "tesSUCCESS" && !(allowDuplicateCredential && resultCode === "tecDUPLICATE")) {
    throw new XrplError(resultCode ?? "submit_failed");
  }
  return { response, resultCode };
}

function submitResult(response: TxResponse): SubmitResult {
  return {
    hash: response.result.hash,
    explorer_url: explorerTx(response.result.hash),
    ledger_index: response.result.ledger_index ?? null,
  };
}

export function credentialCreateOutcome(
  resultCode: string,
  result: SubmitResult,
): CredentialOutcome {
  if (resultCode === "tecDUPLICATE") {
    return { hash: null, explorer_url: null, ledger_index: null, already_issued: true };
  }
  if (resultCode !== "tesSUCCESS") throw new XrplError(resultCode);
  return { ...result, already_issued: false };
}

export async function payoutRlusd(destination: string, amount: string | number): Promise<SubmitResult> {
  assertAddress(destination);
  amountString(amount);
  const wallet = treasuryWallet();
  return withClient(async (client) => {
    const response = await client.request({
      command: "account_lines",
      account: destination,
      peer: RLUSD_TESTNET.issuer,
    });
    if (!hasRlusdTrustLine(response.result.lines)) throw new XrplError("no_trustline");
    const submitted = await submit(client, wallet, buildRlusdPayment(wallet.address, destination, amount));
    return submitResult(submitted.response);
  });
}

export function hasRlusdTrustLine(
  lines: Array<{ account?: string; currency?: string }> | null | undefined,
): boolean {
  return Boolean(
    lines?.some(
      (line) =>
        line.currency?.toUpperCase() === RLUSD_TESTNET.currency &&
        line.account === RLUSD_TESTNET.issuer,
    ),
  );
}

export type PotEscrowResult = SubmitResult & {
  owner: string;
  offer_sequence: number;
  amount_drops: string;
};

export async function createPotEscrow(
  amountXrp: string | number,
  finishAfter: Date,
  opts: { destination?: string; cancelAfter?: Date } = {},
): Promise<PotEscrowResult> {
  const wallet = treasuryWallet();
  const transaction = buildEscrowCreate(wallet.address, amountXrp, finishAfter, {
    ...opts,
    destination: opts.destination ?? wallet.address,
  });
  return withClient(async (client) => {
    const { response } = await submit(client, wallet, transaction);
    const sequence = response.result.tx_json.Sequence;
    if (typeof sequence !== "number") throw new XrplError("missing_sequence");
    return {
      ...submitResult(response),
      owner: wallet.address,
      offer_sequence: sequence,
      amount_drops: transaction.Amount as string,
    };
  });
}

export type FinishEscrowResult = {
  finish: SubmitResult;
  payout: SubmitResult | null;
  amount_drops: string;
};

export async function finishEscrow(input: {
  owner?: string;
  offerSequence: number;
  winner?: string;
}): Promise<FinishEscrowResult> {
  const wallet = treasuryWallet();
  const owner = input.owner ?? wallet.address;
  assertAddress(owner);
  if (input.winner) assertAddress(input.winner);
  return withClient(async (client) => {
    const ledgerResult = await client.request({
      command: "ledger_entry",
      escrow: { owner, seq: input.offerSequence },
      ledger_index: "validated",
    });
    const escrow = ledgerResult.result.node as { Amount?: unknown; Destination?: unknown } | undefined;
    if (!escrow || typeof escrow.Amount !== "string" || typeof escrow.Destination !== "string") {
      throw new XrplError("escrow_not_found");
    }
    const finish = await submit(client, wallet, buildEscrowFinish(wallet.address, owner, input.offerSequence));
    let payout: SubmitResult | null = null;
    if (input.winner && escrow.Destination === wallet.address) {
      const payoutResponse = await submit(client, wallet, {
        TransactionType: "Payment",
        Account: wallet.address,
        Destination: input.winner,
        Amount: escrow.Amount,
      });
      payout = submitResult(payoutResponse.response);
    }
    return { finish: submitResult(finish.response), payout, amount_drops: escrow.Amount };
  });
}

/** Plain XRP payment from the treasury (winner payout after the pot escrow is released). */
export async function payoutXrp(destination: string, amountDrops: string): Promise<SubmitResult> {
  assertAddress(destination);
  if (!/^[1-9]\d*$/.test(amountDrops)) throw new XrplError("invalid_amount");
  const wallet = treasuryWallet();
  return withClient(async (client) => {
    const { response } = await submit(client, wallet, {
      TransactionType: "Payment",
      Account: wallet.address,
      Destination: destination,
      Amount: amountDrops,
    });
    return submitResult(response);
  });
}

/** USD prize to an XRP amount string (testnet rate from XRPL_XRP_PER_USD, default 1 XRP per USD). */
export function potXrpForUsd(usd: number): string {
  const rate = Number(process.env.XRPL_XRP_PER_USD ?? 1);
  const xrp = usd * (Number.isFinite(rate) && rate > 0 ? rate : 1);
  const value = Math.max(xrp, 0.000001).toFixed(6).replace(/\.?0+$/, "");
  return amountString(value);
}

export const dropsToXrpString = (drops: string) => String(dropsToXrp(drops));

export const isClassicAddress = (address: string) => isValidClassicAddress(address);

export async function cancelEscrow(input: { owner?: string; offerSequence: number }): Promise<SubmitResult> {
  const wallet = treasuryWallet();
  const owner = input.owner ?? wallet.address;
  assertAddress(owner);
  return withClient(async (client) => {
    const result = await submit(client, wallet, buildEscrowCancel(wallet.address, owner, input.offerSequence));
    return submitResult(result.response);
  });
}

export async function issueObserverCredential(
  subject: string,
  opts: { uri?: string; expiration?: Date } = {},
): Promise<CredentialOutcome> {
  const wallet = issuerWallet();
  const transaction = buildCredentialCreate(wallet.address, subject, opts);
  return withClient(async (client) => {
    const { response, resultCode } = await submit(client, wallet, transaction, true);
    return credentialCreateOutcome(resultCode, submitResult(response));
  });
}

export async function acceptObserverCredential(subjectWallet: Wallet): Promise<SubmitResult> {
  const issuer = issuerWallet();
  const transaction = buildCredentialAccept(subjectWallet.address, issuer.address);
  return withClient(async (client) => {
    const result = await submit(client, subjectWallet, transaction);
    return submitResult(result.response);
  });
}

export function unixTimestampToRippleTime(timestampMs: number): number {
  if (!Number.isFinite(timestampMs)) throw new XrplError("invalid_time");
  return Math.floor(timestampMs / 1000) - RIPPLE_EPOCH_UNIX_SECONDS;
}

// ---------- XLS-56 Batch, RLUSD via the XRP/RLUSD AMM, and AEYE reputation MPT ----------

export type BatchMode = "allOrNothing" | "independent";

/**
 * Wrap 2-8 same-account transactions in a Batch. Every inner tx gets the
 * tfInnerBatchTxn flag (client.autofill fills Fee/Sequence/SigningPubKey but
 * not the flag, so it is set here).
 */
export function buildBatch(account: string, inner: SubmittableTransaction[], mode: BatchMode): Batch {
  assertAddress(account);
  if (inner.length < 2 || inner.length > 8) throw new XrplError("invalid_batch");
  for (const tx of inner) {
    if (tx.Account !== account) throw new XrplError("invalid_batch");
    tx.Flags = (typeof tx.Flags === "number" ? tx.Flags : 0) | GlobalFlags.tfInnerBatchTxn;
  }
  return {
    TransactionType: "Batch",
    Account: account,
    Flags: mode === "allOrNothing" ? BatchFlags.tfAllOrNothing : BatchFlags.tfIndependent,
    RawTransactions: inner.map((tx) => ({ RawTransaction: tx })),
  };
}

/** Pay `rlusdValue` RLUSD while spending at most `sendMaxDrops` XRP, routed through the AMM. */
export function buildRlusdAmmPayment(
  from: string,
  to: string,
  rlusdValue: string | number,
  sendMaxDrops: string,
): Payment {
  assertAddress(from);
  assertAddress(to);
  if (!/^[1-9]\d*$/.test(sendMaxDrops)) throw new XrplError("invalid_amount");
  const issuedAmount: IssuedCurrencyAmount = {
    currency: RLUSD_TESTNET.currency,
    issuer: RLUSD_TESTNET.issuer,
    value: amountString(rlusdValue),
  };
  return { TransactionType: "Payment", Account: from, Destination: to, Amount: issuedAmount, SendMax: sendMaxDrops };
}

function reputationMptMetadata(): string {
  return encodeMPTokenMetadata({
    ticker: "AEYE",
    name: "A-eye Verified Answers",
    desc: "Non-transferable points minted to observers for accepted on-site answers.",
    icon: `${process.env.A_EYE_PUBLIC_URL ?? "https://a-eye-1zsv.onrender.com"}/icon-192.png`,
    asset_class: "other",
    issuer_name: "A-eye",
  });
}

/** Non-transferable reputation MPT (no tfMPTCanTransfer), XLS-89 metadata. */
export function buildReputationIssuanceCreate(issuer: string): MPTokenIssuanceCreate {
  assertAddress(issuer);
  return {
    TransactionType: "MPTokenIssuanceCreate",
    Account: issuer,
    AssetScale: 0,
    MPTokenMetadata: reputationMptMetadata(),
  };
}

export function buildMptAuthorize(holder: string, issuanceId: string): MPTokenAuthorize {
  assertAddress(holder);
  return { TransactionType: "MPTokenAuthorize", Account: holder, MPTokenIssuanceID: issuanceId };
}

export function buildMptPayment(issuer: string, to: string, issuanceId: string, amount: number): Payment {
  assertAddress(issuer);
  assertAddress(to);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new XrplError("invalid_amount");
  return {
    TransactionType: "Payment",
    Account: issuer,
    Destination: to,
    Amount: { mpt_issuance_id: issuanceId, value: String(amount) },
  };
}

/**
 * One all-or-nothing Batch that opens the RLUSD trust line and opts the
 * observer into the reputation MPT. Without an issuance id it is just the
 * TrustSet (a Batch needs at least two inner transactions).
 */
export function buildObserverOnboardingBatch(address: string, issuanceId?: string): Batch | TrustSet {
  const trustSet = buildTrustSet(address, "1000000");
  if (!issuanceId) return trustSet;
  return buildBatch(address, [trustSet, buildMptAuthorize(address, issuanceId)], "allOrNothing");
}

function submitErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof (error as { data?: unknown }).data === "object" &&
    (error as { data?: object }).data !== null
  ) {
    const data = (error as { data: Record<string, unknown> }).data;
    const code = data.engine_result ?? data.error;
    if (typeof code === "string") return code;
  }
  return error instanceof Error && error.message ? error.message.slice(0, 60) : "submit_failed";
}

export type BatchInnerResult = {
  hash: string;
  type: string;
  result: string | null;
  delivered?: unknown;
};

async function fetchTxMeta(client: Client, hash: string): Promise<{ TransactionResult?: string; delivered_amount?: unknown } | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await client.request({ command: "tx", transaction: hash });
      const meta = response.result.meta;
      if (typeof meta === "object" && meta !== null) return meta as { TransactionResult?: string; delivered_amount?: unknown };
      return null;
    } catch (error) {
      const code = submitErrorCode(error);
      if (code !== "txnNotFound") throw new XrplError(code);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  return null;
}

/**
 * Submit a signed Batch and inspect every inner transaction: the outer result
 * is tesSUCCESS even when inners fail, so each inner is hashed from the
 * submitted RawTransaction and looked up for its real result.
 */
export async function submitBatch(
  client: Client,
  wallet: Wallet,
  batch: Batch,
): Promise<{ batch: SubmitResult; inner: BatchInnerResult[] }> {
  let response: TxResponse;
  try {
    response = await client.submitAndWait(batch, { autofill: true, wallet });
  } catch (error) {
    throw new XrplError(`batch_unavailable:${submitErrorCode(error)}`);
  }
  const outerCode = txResultCode(response);
  if (outerCode !== "tesSUCCESS") throw new XrplError(`batch_unavailable:${outerCode ?? "submit_failed"}`);
  const rawTxs = (response.result.tx_json as { RawTransactions?: { RawTransaction: SubmittableTransaction }[] })
    .RawTransactions ?? [];
  const inner: BatchInnerResult[] = [];
  for (const raw of rawTxs) {
    const tx = raw.RawTransaction;
    const hash = hashes.hashSignedTx(tx);
    const meta = await fetchTxMeta(client, hash);
    inner.push({ hash, type: tx.TransactionType, result: meta?.TransactionResult ?? null, delivered: meta?.delivered_amount });
  }
  return { batch: submitResult(response), inner };
}

/** Drops of XRP per 1 RLUSD on the testnet AMM. */
export async function quoteXrpPerRlusd(client: Client): Promise<number> {
  const response = await client.request({
    command: "amm_info",
    asset: { currency: "XRP" },
    asset2: { currency: RLUSD_TESTNET.currency, issuer: RLUSD_TESTNET.issuer },
  });
  const amm = response.result.amm;
  const xrpDrops = typeof amm.amount === "string" ? Number(amm.amount) : NaN;
  const rlusd = typeof amm.amount2 === "object" && amm.amount2 !== null ? Number(amm.amount2.value) : NaN;
  if (!Number.isFinite(xrpDrops) || !Number.isFinite(rlusd) || rlusd <= 0) throw new XrplError("amm_quote_failed");
  return xrpDrops / rlusd;
}

/**
 * USD prize to XRP using the live AMM quote plus a 10% slippage buffer so the
 * escrowed pot covers the SendMax of the RLUSD payout. Falls back to the fixed
 * XRPL_XRP_PER_USD rate (which is also used whenever that env var is set).
 */
export async function potXrpForUsdQuoted(usd: number): Promise<string> {
  if (process.env.XRPL_XRP_PER_USD) return potXrpForUsd(usd);
  try {
    const dropsPerRlusd = await withClient(quoteXrpPerRlusd);
    const drops = Math.ceil(dropsPerRlusd * 1.1 * usd);
    return amountString((drops / 1_000_000).toFixed(6));
  } catch {
    return potXrpForUsd(usd);
  }
}

async function trustLineInfo(
  client: Client,
  account: string,
): Promise<{ trustline: boolean; balance?: string }> {
  try {
    const response = await client.request({
      command: "account_lines",
      account,
      peer: RLUSD_TESTNET.issuer,
    });
    const line = response.result.lines.find(
      (l) => l.currency?.toUpperCase() === RLUSD_TESTNET.currency && l.account === RLUSD_TESTNET.issuer,
    );
    return { trustline: Boolean(line), balance: line?.balance };
  } catch {
    return { trustline: false };
  }
}

/** Does this account hold an RLUSD trust line on ledger right now? */
export async function accountHasRlusdTrustLine(account: string): Promise<boolean> {
  assertAddress(account);
  return withClient(async (client) => (await trustLineInfo(client, account)).trustline);
}

export type SettlePotBatchResult = {
  batch: SubmitResult;
  finish: { hash: string; explorer_url: string };
  payout: { hash: string; explorer_url: string };
  fee: { hash: string; explorer_url: string } | null;
  payout_currency: "RLUSD" | "XRP";
  payout_amount: string;
};

/**
 * Atomic pot settlement: EscrowFinish + winner payout + platform fee in one
 * all-or-nothing Batch. The XRP released by the finish funds the later inner
 * transactions. Winners with an RLUSD trust line are paid RLUSD through the
 * AMM (SendMax caps the XRP spent); everyone else is paid XRP.
 */
export async function settlePotBatch(input: {
  owner: string;
  offerSequence: number;
  winner: string;
  rlusdValue: string;
  feeDrops: number;
  feeDestination: string;
}): Promise<SettlePotBatchResult> {
  const wallet = treasuryWallet();
  assertAddress(input.owner);
  assertAddress(input.winner);
  assertAddress(input.feeDestination);
  const rlusdValue = amountString(input.rlusdValue);
  if (!Number.isSafeInteger(input.feeDrops) || input.feeDrops < 0) throw new XrplError("invalid_amount");
  return withClient(async (client) => {
    const ledgerResult = await client.request({
      command: "ledger_entry",
      escrow: { owner: input.owner, seq: input.offerSequence },
      ledger_index: "validated",
    });
    const escrow = ledgerResult.result.node as { Amount?: unknown } | undefined;
    if (!escrow || typeof escrow.Amount !== "string") throw new XrplError("escrow_not_found");
    const potDrops = BigInt(escrow.Amount);
    const feeDrops = BigInt(input.feeDrops);
    const payoutDrops = potDrops - feeDrops;
    if (payoutDrops <= 0n) throw new XrplError("invalid_amount");

    const { trustline } = await trustLineInfo(client, input.winner);
    const payout: Payment = trustline
      ? buildRlusdAmmPayment(wallet.address, input.winner, rlusdValue, payoutDrops.toString())
      : {
          TransactionType: "Payment",
          Account: wallet.address,
          Destination: input.winner,
          Amount: payoutDrops.toString(),
        };
    const inner: SubmittableTransaction[] = [
      buildEscrowFinish(wallet.address, input.owner, input.offerSequence),
      payout,
    ];
    if (input.feeDrops > 0) {
      inner.push({
        TransactionType: "Payment",
        Account: wallet.address,
        Destination: input.feeDestination,
        Amount: feeDrops.toString(),
      });
    }
    const submitted = await submitBatch(client, wallet, buildBatch(wallet.address, inner, "allOrNothing"));
    const failed = submitted.inner.find((r) => r.result !== "tesSUCCESS");
    if (failed) throw new XrplError(`batch_failed:${failed.result ?? "unknown"}`);
    const tx = (r: BatchInnerResult) => ({ hash: r.hash, explorer_url: explorerTx(r.hash) });
    return {
      batch: submitted.batch,
      finish: tx(submitted.inner[0]!),
      payout: tx(submitted.inner[1]!),
      fee: submitted.inner[2] ? tx(submitted.inner[2]) : null,
      payout_currency: trustline ? "RLUSD" : "XRP",
      payout_amount: trustline ? rlusdValue : dropsToXrpString(payoutDrops.toString()),
    };
  });
}

/** Single-tx RLUSD-via-AMM payout (the sequential fallback for settlePotBatch). */
export async function payoutRlusdViaAmm(
  destination: string,
  rlusdValue: string | number,
  sendMaxDrops: string,
): Promise<SubmitResult> {
  const wallet = treasuryWallet();
  const transaction = buildRlusdAmmPayment(wallet.address, destination, rlusdValue, sendMaxDrops);
  return withClient(async (client) => {
    const { response } = await submit(client, wallet, transaction);
    return submitResult(response);
  });
}

/** Find or create the issuer's AEYE reputation MPT issuance; returns its id. */
export async function ensureReputationIssuance(client?: Client): Promise<string> {
  const wallet = issuerWallet();
  const find = async (c: Client): Promise<string | undefined> => {
    const response = await c.request({ command: "account_objects", account: wallet.address, type: "mpt_issuance" });
    // `index` is the ledger entry key; the MPTokenIssuanceID is the separate 48-hex `mpt_issuance_id`.
    const entry = (response.result.account_objects as { mpt_issuance_id?: string }[])[0];
    return entry?.mpt_issuance_id;
  };
  const run = async (c: Client): Promise<string> => {
    const existing = await find(c);
    if (existing) return existing;
    const { response } = await submit(c, wallet, buildReputationIssuanceCreate(wallet.address));
    const meta = response.result.meta as { mpt_issuance_id?: string } | undefined;
    if (!meta?.mpt_issuance_id) throw new XrplError("missing_issuance_id");
    return meta.mpt_issuance_id;
  };
  return client ? run(client) : withClient(run);
}

export type ObserverLedgerStatus = {
  funded: boolean;
  xrp_balance?: string;
  rlusd: { trustline: boolean; balance?: string };
  reputation: { opted_in: boolean; balance?: string };
};

export async function observerLedgerStatus(address: string, issuanceId?: string): Promise<ObserverLedgerStatus> {
  assertAddress(address);
  return withClient(async (client) => {
    let funded = false;
    let xrpBalance: string | undefined;
    try {
      const info = await client.request({ command: "account_info", account: address, ledger_index: "validated" });
      funded = true;
      xrpBalance = dropsToXrpString((info.result.account_data as { Balance: string }).Balance);
    } catch (error) {
      if (submitErrorCode(error) !== "actNotFound") throw error;
    }
    const rlusd = funded ? await trustLineInfo(client, address) : { trustline: false };
    let reputation: ObserverLedgerStatus["reputation"] = { opted_in: false };
    if (funded && issuanceId) {
      try {
        const entry = await client.request({
          command: "ledger_entry",
          mptoken: { mpt_issuance_id: issuanceId, account: address },
          ledger_index: "validated",
        });
        const node = entry.result.node as { MPTAmount?: string } | undefined;
        reputation = { opted_in: Boolean(node), balance: node?.MPTAmount };
      } catch (error) {
        if (submitErrorCode(error) !== "entryNotFound") throw error;
      }
    }
    return { funded, xrp_balance: xrpBalance, rlusd, reputation };
  });
}

export type ReputationGrant = { address: string; amount: number };
export type ReputationMintResult = { address: string; amount: number; hash: string | null; result: string };

/**
 * Mint reputation MPT to opted-in holders, chunked into tfIndependent Batches
 * of up to 8 (a single grant goes as a plain Payment). Falls back to
 * sequential Payments when Batch is unavailable.
 */
export async function mintReputation(issuanceId: string, grants: ReputationGrant[]): Promise<ReputationMintResult[]> {
  const wallet = issuerWallet();
  if (grants.length === 0) return [];
  for (const g of grants) {
    assertAddress(g.address);
    if (!Number.isSafeInteger(g.amount) || g.amount <= 0) throw new XrplError("invalid_amount");
  }
  return withClient(async (client) => {
    const results: ReputationMintResult[] = [];
    const sequential = async (list: ReputationGrant[]) => {
      for (const g of list) {
        try {
          const { response } = await submit(client, wallet, buildMptPayment(wallet.address, g.address, issuanceId, g.amount));
          results.push({ ...g, hash: response.result.hash, result: txResultCode(response) ?? "tesSUCCESS" });
        } catch (error) {
          results.push({ ...g, hash: null, result: error instanceof XrplError ? error.code : submitErrorCode(error) });
        }
      }
    };
    if (grants.length === 1) {
      await sequential(grants);
      return results;
    }
    let pending = grants;
    try {
      for (let i = 0; i < pending.length; i += 8) {
        const chunk = pending.slice(i, i + 8);
        if (chunk.length === 1) {
          await sequential(chunk);
          continue;
        }
        const batch = buildBatch(
          wallet.address,
          chunk.map((g) => buildMptPayment(wallet.address, g.address, issuanceId, g.amount)),
          "independent",
        );
        const submitted = await submitBatch(client, wallet, batch);
        chunk.forEach((g, j) => {
          const inner = submitted.inner[j];
          results.push({ ...g, hash: inner?.hash ?? null, result: inner?.result ?? "unknown" });
        });
      }
    } catch (error) {
      if (!(error instanceof XrplError) || !error.code.startsWith("batch_unavailable")) throw error;
      // Batch not usable here; finish the remaining grants one by one.
      pending = pending.slice(results.length);
      await sequential(pending);
    }
    return results;
  });
}

/** Testnet faucet; throws XrplError("faucet_failed") on a non-2xx response. */
export async function fundTestnetAccount(address: string): Promise<void> {
  assertAddress(address);
  const response = await fetch("https://faucet.altnet.rippletest.net/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ destination: address }),
  });
  if (!response.ok) throw new XrplError("faucet_failed");
}

/** Where the platform fee inner payment goes (the issuer account by default). */
export function feeDestination(): string {
  return process.env.XRPL_FEE_ADDRESS ?? issuerWallet().address;
}

/** The platform issuer account (credentials and reputation MPT come from here). */
export function issuerAddress(): string {
  return issuerWallet().address;
}
