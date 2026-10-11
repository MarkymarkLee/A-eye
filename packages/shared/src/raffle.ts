import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const strip0x = (hex: string) => (hex.startsWith("0x") ? hex.slice(2) : hex);

export function generateServerSeed(): string {
  return bytesToHex(randomBytes(32));
}

export function seedCommit(seedHex: string): string {
  return bytesToHex(sha256(hexToBytes(strip0x(seedHex))));
}

export interface DrawInput {
  seedHex: string;
  blockHash: string;
  questionId: string;
  submissionIds: readonly string[];
}

/**
 * winner = sha256(seed ‖ blockHash ‖ utf8(questionId)) mod N over submission ids sorted ascending.
 */
export function drawWinner({ seedHex, blockHash, questionId, submissionIds }: DrawInput): string | null {
  if (submissionIds.length === 0) return null;
  const sorted = [...submissionIds].sort();
  const digest = sha256(
    concatBytes(hexToBytes(strip0x(seedHex)), hexToBytes(strip0x(blockHash)), utf8ToBytes(questionId)),
  );
  const index = Number(BigInt(`0x${bytesToHex(digest)}`) % BigInt(sorted.length));
  return sorted[index]!;
}
