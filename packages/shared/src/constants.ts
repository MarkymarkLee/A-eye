export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const X402_NETWORK = "eip155:84532" as const;

export const AUSD = {
  address: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  decimals: 6,
  eip712: { name: "Agora Dollar", version: "1" },
  faucet: "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C",
} as const;

export const PLATFORM_FEE_BPS = 1000;

export const MAX_GPS_ACCURACY_M = 75;
export const MAX_CAPTURE_SKEW_MS = 2 * 60 * 1000;

export const QUESTION_STATUSES = ["open", "closed", "settled", "expired"] as const;
