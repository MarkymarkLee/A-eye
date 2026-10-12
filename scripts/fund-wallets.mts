/**
 * Print Base Sepolia ETH/AUSD balances for the agent and treasury wallets and drip AUSD
 * from the Agora faucet (requestFunds(address)) to every wallet that has gas.
 *
 *   npx tsx scripts/fund-wallets.mts            # balances + faucet
 *   npx tsx scripts/fund-wallets.mts --dry-run  # balances only
 */
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, formatEther, formatUnits, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as const;
const AUSD_FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C" as const;
const faucetAbi = [
  { type: "function", name: "requestFunds", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }], outputs: [] },
] as const;

const rpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const dryRun = process.argv.includes("--dry-run");
const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });

const wallets = [
  { label: "agent", key: process.env.AGENT_PRIVATE_KEY || process.env.A_EYE_AGENT_PRIVATE_KEY },
  { label: "treasury", key: process.env.A_EYE_TREASURY_PRIVATE_KEY },
];

async function balances(address: Hex) {
  const [eth, ausd] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ]);
  return { eth, ausd };
}

const fmt = (b: { eth: bigint; ausd: bigint }) => `${formatEther(b.eth)} ETH, ${formatUnits(b.ausd, 6)} AUSD`;

for (const { label, key } of wallets) {
  if (!key) {
    console.log(`${label}: no private key in env, skipped`);
    continue;
  }
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
  const before = await balances(account.address);
  console.log(`${label} ${account.address}: ${fmt(before)}`);
  if (dryRun) continue;

  const data = encodeFunctionData({ abi: faucetAbi, functionName: "requestFunds", args: [account.address] });
  // Raw eth_estimateGas without fee fields so it works for a wallet with 0 ETH.
  const gas = await client
    .request({ method: "eth_estimateGas", params: [{ from: account.address, to: AUSD_FAUCET, data }] })
    .then(BigInt)
    .catch((err: Error) => err);
  if (gas instanceof Error) {
    console.log(`  faucet call would revert: ${gas.message.split("\n")[0]}`);
    continue;
  }
  const { maxFeePerGas } = await client.estimateFeesPerGas();
  const needed = (gas * maxFeePerGas * 12n) / 10n;
  if (before.eth < needed) {
    console.log(`  needs ~${formatEther(needed)} ETH for gas to call the AUSD faucet; send Base Sepolia ETH to ${account.address}`);
    continue;
  }
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
  const hash = await wallet.writeContract({ address: AUSD_FAUCET, abi: faucetAbi, functionName: "requestFunds", args: [account.address] });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const after = await balances(account.address);
  console.log(`  faucet tx ${hash} (${receipt.status}) https://sepolia.basescan.org/tx/${hash}`);
  console.log(`  now: ${fmt(after)}`);
}
