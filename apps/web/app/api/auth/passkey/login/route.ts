import { NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { setObserverCookie, peekObserverId } from "@/lib/observer";
import { PasskeyError, verifyLogin } from "@/lib/passkey";
import { getObserver, linkGuestToAccount } from "@/lib/store";
import { parsePasskeyBody, readPasskeyPostBody } from "@/lib/passkey-route";

export async function POST(req: Request) {
  const checked = await readPasskeyPostBody(req, "login");
  if ("response" in checked) return checked.response;
  const body = parsePasskeyBody(checked.text);
  if (!body || !body.response || typeof body.response !== "object" || Array.isArray(body.response)) {
    return NextResponse.json({ error: "Passkey response is missing." }, { status: 400 });
  }
  try {
    const guestId = await peekObserverId();
    const passkey = await verifyLogin(req, body.response as AuthenticationResponseJSON);
    const moved = linkGuestToAccount(guestId, passkey.observer_id);
    const observer = getObserver(passkey.observer_id);
    if (!observer) return NextResponse.json({ error: "We couldn't find that account." }, { status: 404 });
    await setObserverCookie(observer.id);
    return NextResponse.json({ observer, moved });
  } catch (error) {
    if (error instanceof PasskeyError) return NextResponse.json({ error: error.message }, { status: 401 });
    return NextResponse.json({ error: "We couldn't sign you in. Please try again." }, { status: 401 });
  }
}
