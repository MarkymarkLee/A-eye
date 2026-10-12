import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { transferAusdViaFacilitator } from "./chain";

const TREASURY_KEY = generatePrivateKey();
const RECIPIENT = "0x00000000000000000000000000000000000000AA";
const TX = `0x${"ab".repeat(32)}`;

describe("transferAusdViaFacilitator", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("signs an ERC-3009 authorization from the treasury and settles it", async () => {
    vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", TREASURY_KEY);
    const verify = vi.fn(async (_payload: PaymentPayload, _requirements: PaymentRequirements) => ({
      isValid: true,
      payer: privateKeyToAccount(TREASURY_KEY).address,
    }));
    const settle = vi.fn(async () => ({ success: true, transaction: TX, network: "eip155:84532" }));
    const facilitator = {
      verify,
      settle,
      getSupported: vi.fn(async () => ({ kinds: [], extensions: [], signers: {} })),
    } as unknown as FacilitatorClient;

    await expect(transferAusdViaFacilitator(RECIPIENT, 25_000n, facilitator)).resolves.toBe(TX);
    const [payload, requirements] = verify.mock.calls[0]!;
    expect(payload.payload).toMatchObject({
      authorization: {
        from: privateKeyToAccount(TREASURY_KEY).address,
        to: RECIPIENT,
        value: "25000",
      },
    });
    expect(payload.payload).toHaveProperty("signature");
    expect(payload.accepted).toEqual(requirements);
    expect(requirements).toMatchObject({ payTo: RECIPIENT, amount: "25000" });
    expect(settle).toHaveBeenCalledExactlyOnceWith(payload, requirements);
  });

  it("throws when the facilitator rejects the authorization", async () => {
    vi.stubEnv("A_EYE_TREASURY_PRIVATE_KEY", TREASURY_KEY);
    const facilitator = {
      verify: vi.fn(async () => ({ isValid: false, invalidReason: "invalid", invalidMessage: "bad signature" })),
      settle: vi.fn(),
      getSupported: vi.fn(async () => ({ kinds: [], extensions: [], signers: {} })),
    } as unknown as FacilitatorClient;

    await expect(transferAusdViaFacilitator(RECIPIENT, 25_000n, facilitator)).rejects.toThrow("invalid: bad signature");
    expect(facilitator.settle).not.toHaveBeenCalled();
  });
});
