"use client";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

export function browserSupportsPasskeys(): boolean {
  return typeof window !== "undefined" && browserSupportsWebAuthn();
}

export async function startPasskeyRegistration(
  options: PublicKeyCredentialCreationOptionsJSON,
): Promise<RegistrationResponseJSON> {
  if (!browserSupportsPasskeys()) throw new Error("This browser can't save passkeys.");
  try {
    return await startRegistration({ optionsJSON: options });
  } catch (error) {
    throw new Error(passkeyErrorMessage(error));
  }
}

export async function startPasskeyAuthentication(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON> {
  if (!browserSupportsPasskeys()) throw new Error("This browser can't save passkeys.");
  try {
    return await startAuthentication({ optionsJSON: options });
  } catch (error) {
    throw new Error(passkeyErrorMessage(error));
  }
}

export function passkeyErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error && error.name === "NotAllowedError") {
    return "Face ID was cancelled. Try again when you're ready.";
  }
  if (!browserSupportsPasskeys()) return "This browser can't save passkeys.";
  return error instanceof Error ? error.message : "We couldn't use that passkey. Please try again.";
}
