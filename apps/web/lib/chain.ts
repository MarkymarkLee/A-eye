import { AUSD } from "@a-eye/shared";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  nonceManager,
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

/** Send AUSD from the treasury (raffle payouts, refunds) and wait for 1 confirmation. */
export async function transferAusd(to: string, amountUnits: bigint): Promise<Hex> {
  if (!isAddress(to)) throw new Error(`Invalid recipient address: ${to}`);
  if (amountUnits <= BigInt(0)) throw new Error("Amount must be positive");
  const account = treasuryAccount();
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl()) });
  const hash = await wallet.writeContract({
    address: AUSD.address,
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(to), amountUnits],
  });
  const receipt = await publicClient().waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`AUSD transfer reverted: ${hash}`);
  return hash;
}
