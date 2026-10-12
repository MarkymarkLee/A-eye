import { randomBytes } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { drawWinner, newSeed } from "./raffle";
import { raffleSnippet } from "./raffle-snippet";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const randomId = () =>
  Array.from(randomBytes(12), (byte) => alphabet[byte % alphabet.length]).join("");

describe("raffleSnippet", () => {
  it("reproduces the draw in Web Crypto for random inputs", async () => {
    for (let caseNo = 0; caseNo < 64; caseNo++) {
      const { seed, commit } = newSeed();
      const blockHash =
        caseNo < 3 ? `offline:${randomBytes(32).toString("hex")}` : `0x${randomBytes(32).toString("hex")}`;
      const questionId = randomId();
      const size = (caseNo % 25) + 1;
      const submissionIds = Array.from({ length: size }, randomId);
      for (let i = submissionIds.length - 1; i > 0; i--) {
        const j = randomBytes(1)[0]! % (i + 1);
        [submissionIds[i], submissionIds[j]] = [submissionIds[j]!, submissionIds[i]!];
      }

      const expected = drawWinner(seed, blockHash, questionId, submissionIds)!;
      const snippet = raffleSnippet({
        questionId,
        seedReveal: seed,
        seedCommit: commit,
        blockHash,
        submissionIds,
      });
      const result = await runInNewContext(snippet, {
        crypto: globalThis.crypto,
        TextEncoder,
        console: { log() {} },
      });

      expect(result).toEqual({
        commit_ok: true,
        index: expected.index,
        winner: expected.winner,
        entrants: size,
      });
    }
  });

  it("reports a wrong seed commitment", async () => {
    const { seed } = newSeed();
    const result = await runInNewContext(
      raffleSnippet({
        questionId: "question",
        seedReveal: seed,
        seedCommit: "wrong",
        blockHash: `0x${randomBytes(32).toString("hex")}`,
        submissionIds: ["submission"],
      }),
      { crypto: globalThis.crypto, TextEncoder, console: { log() {} } },
    );
    expect(result.commit_ok).toBe(false);
  });
});
