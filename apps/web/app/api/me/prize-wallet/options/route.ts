import { NextResponse } from "next/server";
import { currentObserver } from "@/lib/observer";
import { registrationOptions, walletConfirmationOptions } from "@/lib/passkey";
import { parsePasskeyBody, readPasskeyPostBody } from "@/lib/passkey-route";
import { passkeysFor } from "@/lib/store";
import { passkeyWalletEnabled } from "@/lib/smart-wallet";

export async function POST(req: Request) {
  const checked = await readPasskeyPostBody(req, "prize-wallet-options");
  if ("response" in checked) return checked.response;
  if (!parsePasskeyBody(checked.text)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (!passkeyWalletEnabled()) return NextResponse.json({ error: "Prize wallets are unavailable right now." }, { status: 404 });

  const observer = await currentObserver();
  if (observer.evm_address) return NextResponse.json({ mode: "existing", address: observer.evm_address });
  try {
    if (passkeysFor(observer.id).length > 0) {
      return NextResponse.json({
        mode: "confirm",
        options: await walletConfirmationOptions(req, observer.id),
      });
    }
    return NextResponse.json({
      mode: "create",
      options: await registrationOptions(req, observer.id, observer.display_name),
    });
  } catch {
    return NextResponse.json({ error: "We couldn't start Face ID. Please try again." }, { status: 400 });
  }
}
