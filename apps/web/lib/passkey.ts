import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { decodeCredentialPublicKey } from "@simplewebauthn/server/helpers";
import { originOf } from "./origin";
import {
  consumeChallenge,
  getPasskey,
  passkeysFor,
  saveChallenge,
  savePasskey,
  touchPasskey,
  type PasskeyRecord,
} from "./store";

export class PasskeyError extends Error {}

export function rpFor(req: Request) {
  const origin = (process.env.A_EYE_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || originOf(req)).replace(/\/+$/, "");
  return { origin, rpID: new URL(origin).hostname, rpName: "A-eye" };
}

export async function registrationOptions(
  req: Request,
  observerId: string,
  displayName: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID, rpName } = rpFor(req);
  const existing = passkeysFor(observerId);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: displayName,
    userDisplayName: displayName,
    userID: new TextEncoder().encode(observerId),
    attestationType: "none",
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.id,
      transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [-7],
  });
  saveChallenge(options.challenge, "register", observerId);
  return options;
}

export async function verifyRegistration(
  req: Request,
  observerId: string,
  response: RegistrationResponseJSON,
): Promise<PasskeyRecord> {
  return savePasskey(await verifyRegistrationCredential(req, observerId, response));
}

export async function verifyRegistrationCredential(
  req: Request,
  observerId: string,
  response: RegistrationResponseJSON,
): Promise<{ id: string; observer_id: string; public_key: string; counter: number; transports: string[] | null }> {
  const { origin, rpID } = rpFor(req);
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: (challenge) => consumeChallenge(challenge, "register", observerId),
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    supportedAlgorithmIDs: [-7],
  });
  if (!result.verified || !result.registrationInfo) throw new PasskeyError("Passkey verification failed.");
  const credential = result.registrationInfo.credential;
  if (getPasskey(credential.id)) throw new PasskeyError("This passkey is already saved.");
  const publicKey = Buffer.from(credential.publicKey).toString("base64url");
  const transports = response.response.transports ?? credential.transports;
  return {
    id: credential.id,
    observer_id: observerId,
    public_key: publicKey,
    counter: credential.counter,
    transports: transports ? [...transports] : null,
  };
}

export async function loginOptions(req: Request): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = rpFor(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  saveChallenge(options.challenge, "login", null);
  return options;
}

export async function walletConfirmationOptions(
  req: Request,
  observerId: string,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = rpFor(req);
  const credentials = passkeysFor(observerId);
  if (!credentials.length) throw new PasskeyError("No passkey is saved for this account.");
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: credentials.map((passkey) => ({
      id: passkey.id,
      transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
    })),
  });
  saveChallenge(options.challenge, "wallet", observerId);
  return options;
}

async function verifyAuthentication(
  req: Request,
  purpose: "login" | "wallet",
  observerId: string | null,
  response: AuthenticationResponseJSON,
): Promise<PasskeyRecord> {
  const passkey = getPasskey(response.id);
  if (!passkey) throw new PasskeyError("Passkey not found.");
  if (purpose === "wallet" && passkey.observer_id !== observerId) throw new PasskeyError("That passkey belongs to another account.");
  const { origin, rpID } = rpFor(req);
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: (challenge) => consumeChallenge(challenge, purpose, observerId),
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: passkey.id,
      publicKey: Buffer.from(passkey.public_key, "base64url"),
      counter: passkey.counter,
      transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
    },
  });
  if (!result.verified) throw new PasskeyError("Passkey verification failed.");
  touchPasskey(passkey.id, result.authenticationInfo.newCounter);
  return getPasskey(passkey.id)!;
}

export function verifyLogin(req: Request, response: AuthenticationResponseJSON): Promise<PasskeyRecord> {
  return verifyAuthentication(req, "login", null, response);
}

export function verifyWalletConfirmation(
  req: Request,
  observerId: string,
  response: AuthenticationResponseJSON,
): Promise<PasskeyRecord> {
  return verifyAuthentication(req, "wallet", observerId, response);
}
