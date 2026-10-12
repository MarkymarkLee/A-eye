import { NextResponse } from "next/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { currentObserver } from "@/lib/observer";
import { PasskeyError, verifyRegistrationCredential, verifyWalletConfirmation } from "@/lib/passkey";
import { parsePasskeyBody, readPasskeyPostBody } from "@/lib/passkey-route";
import type { PasskeyRecord } from "@/lib/store";
import {
  getObserver,
  observerPrizes,
  retryWinnerPayouts,
  savePasskey,
  setObserverEvmIfEmpty,
  setPasskeyWallet,
} from "@/lib/store";
import { passkeyOwnerBytes, passkeyWalletEnabled, smartWalletAddress } from "@/lib/smart-wallet";

export async function POST(req: Request) {
  const checked = await readPasskeyPostBody(req, "prize-wallet");
  if ("response" in checked) return checked.response;
  const body = parsePasskeyBody(checked.text);
  if (
    !body ||
    (body.mode !== "create" && body.mode !== "confirm") ||
    !body.response ||
    typeof body.response !== "object" ||
    Array.isArray(body.response)
  ) {
    return NextResponse.json({ error: "Passkey response is missing." }, { status: 400 });
  }
  if (!passkeyWalletEnabled()) return NextResponse.json({ error: "Prize wallets are unavailable right now." }, { status: 404 });

  const observer = await currentObserver();
  if (observer.evm_address) return NextResponse.json({ address: observer.evm_address, prizes: observerPrizes(observer.id) });

  let credentialId: string;
  let publicKey: string;
  let newCredential: Awaited<ReturnType<typeof verifyRegistrationCredential>> | undefined;
  try {
    if (body.mode === "create") {
      newCredential = await verifyRegistrationCredential(req, observer.id, body.response as RegistrationResponseJSON);
      credentialId = newCredential.id;
      publicKey = newCredential.public_key;
    } else {
      const credential: PasskeyRecord = await verifyWalletConfirmation(req, observer.id, body.response as AuthenticationResponseJSON);
      credentialId = credential.id;
      publicKey = credential.public_key;
    }
  } catch (error) {
    if (error instanceof PasskeyError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "We couldn't verify that passkey. Please try again." }, { status: 400 });
  }

  let ownerBytes;
  try {
    ownerBytes = passkeyOwnerBytes(publicKey);
  } catch {
    return NextResponse.json({ error: "This passkey can't create a prize wallet. Try another passkey." }, { status: 400 });
  }

  let address: string;
  try {
    address = await smartWalletAddress(ownerBytes);
  } catch {
    return NextResponse.json({ error: "Your prize wallet couldn't be reached right now. Please try again." }, { status: 502 });
  }

  try {
    if (newCredential) savePasskey(newCredential);
    setPasskeyWallet(credentialId, address);
    if (setObserverEvmIfEmpty(observer.id, address)) retryWinnerPayouts(observer.id);
    return NextResponse.json({
      address,
      prizes: observerPrizes(observer.id),
      account: getObserver(observer.id),
    });
  } catch {
    return NextResponse.json({ error: "Your prize wallet couldn't be saved. Please try again." }, { status: 500 });
  }
}
