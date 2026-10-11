import { NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { currentObserver } from "@/lib/observer";
import { PasskeyError, verifyRegistration } from "@/lib/passkey";
import { passkeysFor } from "@/lib/store";
import { parsePasskeyBody, readPasskeyPostBody } from "@/lib/passkey-route";

export async function POST(req: Request) {
  const checked = await readPasskeyPostBody(req, "register");
  if ("response" in checked) return checked.response;
  const body = parsePasskeyBody(checked.text);
  if (!body || !body.response || typeof body.response !== "object" || Array.isArray(body.response)) {
    return NextResponse.json({ error: "Passkey response is missing." }, { status: 400 });
  }
  const observer = await currentObserver();
  try {
    await verifyRegistration(req, observer.id, body.response as RegistrationResponseJSON);
    return NextResponse.json({
      ok: true,
      account: { observer_id: observer.id, display_name: observer.display_name, has_passkey: passkeysFor(observer.id).length > 0 },
    });
  } catch (error) {
    if (error instanceof PasskeyError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "We couldn't save that passkey. Please try again." }, { status: 400 });
  }
}
