import { describe, expect, it } from "vitest";
import { drawWinner, generateServerSeed, seedCommit } from "../src/raffle.js";

const seedHex = "11".repeat(32);
const blockHash = "0x" + "ab".repeat(32);
const ids = ["sub_c", "sub_a", "sub_b", "sub_d"];

describe("raffle", () => {
  it("commit is sha256 of the seed bytes", () => {
    expect(seedCommit(seedHex)).toBe("02d449a31fbb267c8f352e9968a79e3e5fc95c1bbeaa502fd6454ebde5a4bedc");
  });

  it("generates 32-byte hex seeds", () => {
    expect(generateServerSeed()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic and independent of input order", () => {
    const a = drawWinner({ seedHex, blockHash, questionId: "q1", submissionIds: ids });
    const b = drawWinner({ seedHex, blockHash, questionId: "q1", submissionIds: [...ids].reverse() });
    expect(a).toBe(b);
    expect(ids).toContain(a);
  });

  it("changes with the block hash", () => {
    const winners = new Set(
      Array.from({ length: 20 }, (_, i) =>
        drawWinner({ seedHex, blockHash: "0x" + i.toString(16).padStart(64, "0"), questionId: "q1", submissionIds: ids }),
      ),
    );
    expect(winners.size).toBeGreaterThan(1);
  });

  it("returns null with no entries", () => {
    expect(drawWinner({ seedHex, blockHash, questionId: "q1", submissionIds: [] })).toBeNull();
  });
});
