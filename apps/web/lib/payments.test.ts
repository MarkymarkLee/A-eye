import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transferAusd = vi.fn();
vi.mock("./chain", async (orig) => ({ ...(await orig<typeof import("./chain")>()), transferAusd }));

const { paymentsEnabled, prizeUnits, questionPayTo, sendFromTreasury, winnerPayoutUnits } = await import("./payments");

const TREASURY_KEY = `0x${"11".repeat(32)}`;
const WINNER = "0x00000000000000000000000000000000000000aa";
const TX = `0x${"ef".repeat(32)}`;

describe("payments", () => {
  beforeEach(() => {
    vi.stubEnv("A_EYE_TREASURY_ADDRESS", "");
    vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", "");
    transferAusd.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());

  it("converts prizes to AUSD base units and takes the 10% platform fee from the winner payout", () => {
    expect(prizeUnits(0.01)).toBe(BigInt(10_000));
    expect(prizeUnits(2.5)).toBe(BigInt(2_500_000));
    expect(winnerPayoutUnits(2.5)).toBe(BigInt(2_250_000));
  });

  it("enables x402 only when a treasury address or key is configured", () => {
    expect(paymentsEnabled()).toBe(false);
    vi.stubEnv("A_EYE_TREASURY_ADDRESS", "0x293214291186180810902D97994c2C72fE88255A");
    expect(questionPayTo()).toBe("0x293214291186180810902D97994c2C72fE88255A");
    vi.stubEnv("A_EYE_TREASURY_ADDRESS", "");
    vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", TREASURY_KEY);
    expect(paymentsEnabled()).toBe(true);
  });

  it("skips transfers without a treasury key or recipient", async () => {
    expect(await sendFromTreasury("payout", WINNER, BigInt(1))).toBeNull();
    vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", TREASURY_KEY);
    expect(await sendFromTreasury("payout", null, BigInt(1))).toBeNull();
    expect(transferAusd).not.toHaveBeenCalled();
  });

  it("returns the tx hash, and swallows chain errors", async () => {
    vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", TREASURY_KEY);
    transferAusd.mockResolvedValueOnce(TX);
    expect(await sendFromTreasury("refund", WINNER, BigInt(10_000))).toBe(TX);
    expect(transferAusd).toHaveBeenCalledWith(WINNER, BigInt(10_000));
    transferAusd.mockRejectedValueOnce(new Error("insufficient funds"));
    expect(await sendFromTreasury("payout", WINNER, BigInt(10_000))).toBeNull();
  });
});
