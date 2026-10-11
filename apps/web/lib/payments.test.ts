import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transferAusd = vi.fn();
const transferAusdViaFacilitator = vi.fn();
vi.mock("./chain", async (orig) => ({ ...(await orig<typeof import("./chain")>()), transferAusd, transferAusdViaFacilitator }));

const {
  paymentsEnabled,
  peekPaywallActive,
  peekPriceUnits,
  prizeUnits,
  questionPayTo,
  sendFromTreasury,
  winnerPayoutUnits,
} = await import("./payments");

const TREASURY_KEY = `0x${"11".repeat(32)}`;
const WINNER = "0x00000000000000000000000000000000000000aa";
const TX = `0x${"ef".repeat(32)}`;

describe("payments", () => {
  beforeEach(() => {
    vi.stubEnv("A_EYE_TREASURY_ADDRESS", "");
    vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", "");
    vi.stubEnv("ALLOW_UNPAID_QUESTIONS", "");
    transferAusd.mockReset();
    transferAusdViaFacilitator.mockReset().mockRejectedValue(new Error("facilitator unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());

  it("converts prizes to AUSD base units and takes the 10% platform fee from the winner payout", () => {
    expect(prizeUnits(0.01)).toBe(BigInt(10_000));
    expect(prizeUnits(2.5)).toBe(BigInt(2_500_000));
    expect(winnerPayoutUnits(2.5)).toBe(BigInt(2_250_000));
    expect(winnerPayoutUnits(2.52)).toBe(BigInt(2_270_000));
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

  it("uses the facilitator rail first and falls back to direct transfer on failure", async () => {
    vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", TREASURY_KEY);
    transferAusdViaFacilitator.mockResolvedValueOnce(TX);
    expect(await sendFromTreasury("payout", WINNER, 10_000n)).toBe(TX);
    expect(transferAusdViaFacilitator).toHaveBeenCalledExactlyOnceWith(WINNER, 10_000n);
    expect(transferAusd).not.toHaveBeenCalled();

    transferAusd.mockResolvedValueOnce(TX);
    expect(await sendFromTreasury("refund", WINNER, 10_000n)).toBe(TX);
    expect(transferAusd).toHaveBeenCalledExactlyOnceWith(WINNER, 10_000n);
  });

  it("skips the facilitator when the direct rail is selected", async () => {
    vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", TREASURY_KEY);
    vi.stubEnv("A_EYE_PAYOUT_RAIL", "direct");
    transferAusd.mockResolvedValueOnce(TX);
    expect(await sendFromTreasury("payout", WINNER, 10_000n)).toBe(TX);
    expect(transferAusdViaFacilitator).not.toHaveBeenCalled();
  });

  it("returns null when both payout rails fail", async () => {
    vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", TREASURY_KEY);
    transferAusd.mockRejectedValueOnce(new Error("direct unavailable"));
    expect(await sendFromTreasury("payout", WINNER, 10_000n)).toBeNull();
  });

  it("defaults invalid peek prices and disables the paywall at zero or in unpaid mode", () => {
    vi.stubEnv("A_EYE_TREASURY_ADDRESS", "0x293214291186180810902D97994c2C72fE88255A");
    expect(peekPriceUnits()).toBe(20_000n);
    expect(peekPaywallActive()).toBe(true);
    vi.stubEnv("A_EYE_PEEK_PRICE_USD", "not-a-number");
    expect(peekPriceUnits()).toBe(20_000n);
    vi.stubEnv("A_EYE_PEEK_PRICE_USD", "-1");
    expect(peekPriceUnits()).toBe(20_000n);
    vi.stubEnv("A_EYE_PEEK_PRICE_USD", "0");
    expect(peekPaywallActive()).toBe(false);
    vi.stubEnv("A_EYE_PEEK_PRICE_USD", "0.02");
    vi.stubEnv("ALLOW_UNPAID_QUESTIONS", "1");
    expect(peekPaywallActive()).toBe(false);
  });
});
