import { createECDH, generateKeyPairSync } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { Hex } from "viem";

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(async () => "0x1234567890123456789012345678901234567890"),
}));

vi.mock("server-only", () => ({}));
vi.mock("./chain", () => ({ publicClient: () => ({ readContract: mocks.readContract }) }));
afterAll(() => vi.unstubAllEnvs());

const { passkeyOwnerBytes, smartWalletAddress, COINBASE_SMART_WALLET_FACTORY } = await import("./smart-wallet");

const coseKey = (fields: Map<number, number | Uint8Array>) =>
  Buffer.from(isoCBOR.encode(fields)).toString("base64url");

describe("passkeyOwnerBytes", () => {
  it("returns the concatenated 32-byte P-256 coordinates", () => {
    const ecdh = createECDH("prime256v1");
    const point = ecdh.generateKeys();
    const x = point.subarray(1, 33);
    const y = point.subarray(33, 65);
    const encoded = coseKey(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, x],
        [-3, y],
      ]),
    );
    expect(passkeyOwnerBytes(encoded)).toBe(`0x${x.toString("hex")}${y.toString("hex")}`);
  });

  it("rejects non-P-256 EC and RSA keys", () => {
    const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).publicKey.export({ format: "jwk" });
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
    const p384x = Buffer.from(p384.x!, "base64url");
    const p384y = Buffer.from(p384.y!, "base64url");
    const rsaN = Buffer.from(rsa.n!, "base64url");
    const rsaE = Buffer.from(rsa.e!, "base64url");
    expect(() =>
      passkeyOwnerBytes(
        coseKey(
          new Map<number, number | Uint8Array>([
            [1, 2],
            [3, -7],
            [-1, 2],
            [-2, p384x],
            [-3, p384y],
          ]),
        ),
      ),
    ).toThrow(/P-256/);
    expect(() =>
      passkeyOwnerBytes(
        coseKey(
          new Map<number, number | Uint8Array>([
            [1, 3],
            [3, -257],
            [-1, rsaN],
            [-2, rsaE],
          ]),
        ),
      ),
    ).toThrow(/P-256/);
  });
});

describe("smartWalletAddress", () => {
  it("asks the Base Sepolia factory for the address using the passkey owner", async () => {
    mocks.readContract.mockClear();
    const owner = `0x${"11".repeat(64)}` as Hex;
    await expect(smartWalletAddress(owner)).resolves.toBe("0x1234567890123456789012345678901234567890");
    expect(mocks.readContract).toHaveBeenCalledWith({
      address: COINBASE_SMART_WALLET_FACTORY,
      abi: expect.any(Array),
      functionName: "getAddress",
      args: [[owner], 0n],
    });
  });
});
