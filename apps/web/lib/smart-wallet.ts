import "server-only";
import { decodeCredentialPublicKey, cose } from "@simplewebauthn/server/helpers";
import { type Address, type Hex } from "viem";
import { publicClient } from "./chain";

export const COINBASE_SMART_WALLET_FACTORY = "0xba5ed110efdba3d005bfc882d75358acbbb85842" as Address;

const factoryAbi = [
  {
    type: "function",
    name: "getAddress",
    stateMutability: "view",
    inputs: [
      { name: "owners", type: "bytes[]" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ name: "account", type: "address" }],
  },
] as const;

export function passkeyWalletEnabled(): boolean {
  return process.env.A_EYE_PASSKEY_WALLET !== "0";
}

export function passkeyOwnerBytes(cosePublicKeyB64url: string): Hex {
  const key = decodeCredentialPublicKey(Buffer.from(cosePublicKeyB64url, "base64url")) as Map<number, number | Uint8Array>;
  if (
    key.get(cose.COSEKEYS.kty) !== cose.COSEKTY.EC2 ||
    key.get(cose.COSEKEYS.alg) !== cose.COSEALG.ES256 ||
    key.get(cose.COSEKEYS.crv) !== cose.COSECRV.P256
  ) {
    throw new Error("Passkey must use a P-256 key.");
  }
  const x = key.get(cose.COSEKEYS.x) as Uint8Array | undefined;
  const y = key.get(cose.COSEKEYS.y) as Uint8Array | undefined;
  if (!x || !y || x.byteLength !== 32 || y.byteLength !== 32) throw new Error("Invalid P-256 passkey key.");
  return `0x${Buffer.from(x).toString("hex")}${Buffer.from(y).toString("hex")}`;
}

export async function smartWalletAddress(ownerBytes: Hex): Promise<Address> {
  return publicClient().readContract({
    address: COINBASE_SMART_WALLET_FACTORY,
    abi: factoryAbi,
    functionName: "getAddress",
    args: [[ownerBytes], 0n],
  });
}
