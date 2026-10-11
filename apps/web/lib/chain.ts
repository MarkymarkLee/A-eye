import { AUSD } from "@a-eye/shared";
import { X402_NETWORK } from "@a-eye/shared";
import { type FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { facilitatorFromEnv } from "./x402";
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  keccak256,
  nonceManager,
  NonceTooLowError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

export const DEFAULT_BASE_SEPOLIA_RPC = "https://sepolia.base.org";

export class ChainConfigError extends Error {}

export const explorerTxUrl = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;

const rpcUrl = () => process.env.BASE_SEPOLIA_RPC_URL || DEFAULT_BASE_SEPOLIA_RPC;

const makePublicClient = (url: string) => createPublicClient({ chain: baseSepolia, transport: http(url) });

let cachedPublic: { url: string; client: ReturnType<typeof makePublicClient> } | undefined;
export function publicClient() {
  const url = rpcUrl();
  if (!cachedPublic || cachedPublic.url !== url) cachedPublic = { url, client: makePublicClient(url) };
  return cachedPublic.client;
}

let cachedTreasury: { key: string; account: PrivateKeyAccount } | undefined;
export function treasuryAccount(): PrivateKeyAccount {
  const key = process.env.A_EYE_TREASURY_PRIVATE_KEY;
  if (!key) throw new ChainConfigError("A_EYE_TREASURY_PRIVATE_KEY is not set");
  if (cachedTreasury?.key !== key) {
    const hex = (key.startsWith("0x") ? key : `0x${key}`) as Hex;
    cachedTreasury = { key, account: privateKeyToAccount(hex, { nonceManager }) };
  }
  return cachedTreasury.account;
}

/** Treasury address from `A_EYE_TREASURY_ADDRESS`, else derived from the private key; `undefined` if neither is set. */
export function treasuryAddress(): Address | undefined {
  const explicit = process.env.A_EYE_TREASURY_ADDRESS;
  if (explicit && isAddress(explicit)) return getAddress(explicit);
  return process.env.A_EYE_TREASURY_PRIVATE_KEY ? treasuryAccount().address : undefined;
}

export const isTreasuryConfigured = () => Boolean(process.env.A_EYE_TREASURY_PRIVATE_KEY);

export async function latestBlockHash(): Promise<Hex> {
  const block = await publicClient().getBlock({ blockTag: "latest" });
  if (!block.hash) throw new Error("Latest block has no hash");
  return block.hash;
}

export function ausdBalance(addr: string): Promise<bigint> {
  return publicClient().readContract({
    address: AUSD.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(addr)],
  });
}

export function ethBalance(addr: string): Promise<bigint> {
  return publicClient().getBalance({ address: getAddress(addr) });
}

/**
 * Send AUSD from the treasury (raffle payouts, refunds) and wait for 1 confirmation.
 * The transaction is signed first and `hooks.onSigned` runs synchronously with its
 * hash + raw bytes before anything is broadcast, so the caller can persist both;
 * if onSigned throws, the transaction is never broadcast.
 */
export async function transferAusd(
  to: string,
  amountUnits: bigint,
  hooks?: { onSigned?: (tx: { hash: Hex; raw: Hex }) => void },
): Promise<Hex> {
  if (!isAddress(to)) throw new Error(`Invalid recipient address: ${to}`);
  if (amountUnits <= BigInt(0)) throw new Error("Amount must be positive");
  const account = treasuryAccount();
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl()) });
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(to), amountUnits],
  });
  const request = await wallet.prepareTransactionRequest({ to: AUSD.address, data });
  const raw = await wallet.signTransaction(request);
  const hash = keccak256(raw);
  hooks?.onSigned?.({ hash, raw });
  await publicClient().sendRawTransaction({ serializedTransaction: raw });
  const receipt = await publicClient().waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`AUSD transfer reverted: ${hash}`);
  return hash;
}

/** On-chain status of a previously broadcast AUSD transfer hash. */
export async function ausdTxStatus(hash: Hex): Promise<"success" | "reverted" | "missing"> {
  try {
    const receipt = await publicClient().getTransactionReceipt({ hash });
    return receipt.status === "success" ? "success" : "reverted";
  } catch (err) {
    if (err instanceof TransactionReceiptNotFoundError) return "missing";
    if (err instanceof BaseError && err.name === "TransactionReceiptNotFoundError") return "missing";
    throw err;
  }
}

/** Re-broadcast a persisted raw transaction that may never have reached the mempool. */
export async function rebroadcastRawTx(raw: Hex): Promise<"ok" | "nonce_used"> {
  try {
    await publicClient().sendRawTransaction({ serializedTransaction: raw });
    return "ok";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof NonceTooLowError || /nonce too low/i.test(message)) return "nonce_used";
    if (/already known|known transaction|already imported/i.test(message)) return "ok";
    throw err;
  }
}

export async function transferAusdViaFacilitator(
  to: string,
  amountUnits: bigint,
  facilitator?: FacilitatorClient,
): Promise<Hex> {
  if (!isAddress(to)) throw new Error(`Invalid recipient address: ${to}`);
  if (amountUnits <= BigInt(0)) throw new Error("Amount must be positive");
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: X402_NETWORK,
    asset: AUSD.address,
    amount: amountUnits.toString(),
    payTo: getAddress(to),
    maxTimeoutSeconds: 300,
    extra: { ...AUSD.eip712 },
  };
  const partial = await new ExactEvmScheme(treasuryAccount()).createPaymentPayload(2, requirements);
  const payload: PaymentPayload = {
    ...partial,
    accepted: requirements,
    resource: {
      url: `${process.env.A_EYE_PUBLIC_URL ?? "https://a-eye-1zsv.onrender.com"}/payouts`,
      description: "A-eye treasury payout",
      mimeType: "application/json",
    },
  };
  const client = facilitator ?? facilitatorFromEnv();
  const verified = await client.verify(payload, requirements);
  if (!verified.isValid) {
    const reason = [verified.invalidReason, verified.invalidMessage].filter(Boolean).join(": ");
    throw new Error(reason || "Facilitator rejected treasury payout");
  }
  const settled = await client.settle(payload, requirements);
  if (!settled.success) {
    const reason = [settled.errorReason, settled.errorMessage].filter(Boolean).join(": ");
    throw new Error(reason || "Facilitator failed to settle treasury payout");
  }
  return settled.transaction as Hex;
}
