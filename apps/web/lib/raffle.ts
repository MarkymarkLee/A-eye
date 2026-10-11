import { createHash, randomBytes } from "node:crypto";

export const sha256Hex = (input: string | Buffer | Uint8Array) =>
  createHash("sha256").update(input).digest("hex");

export function newSeed() {
  const seed = randomBytes(32).toString("hex");
  return { seed, commit: sha256Hex(seed) };
}

/**
 * Provably fair draw: H(seed ‖ blockHash ‖ questionId) mod N over accepted
 * submission ids sorted ascending. Anyone with the revealed seed can recompute it.
 */
export function drawWinner(seed: string, blockHash: string, questionId: string, submissionIds: string[]) {
  if (submissionIds.length === 0) return undefined;
  const sorted = [...submissionIds].sort();
  const digest = sha256Hex(`${seed}${blockHash}${questionId}`);
  const index = Number(BigInt(`0x${digest}`) % BigInt(sorted.length));
  return { index, winner: sorted[index]! };
}

const BASE_SEPOLIA_RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

/** Latest Base Sepolia block, used as public entropy the server cannot choose. */
export async function latestBlock(): Promise<{ hash: string; number: number } | undefined> {
  try {
    const res = await fetch(BASE_SEPOLIA_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    const json = (await res.json()) as { result?: { hash: string; number: string } };
    if (!json.result) return undefined;
    return { hash: json.result.hash, number: Number.parseInt(json.result.number, 16) };
  } catch {
    return undefined;
  }
}
