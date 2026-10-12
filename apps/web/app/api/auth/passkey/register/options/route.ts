import { NextResponse } from "next/server";
import { currentObserver } from "@/lib/observer";
import { registrationOptions } from "@/lib/passkey";
import { parsePasskeyBody, readPasskeyPostBody } from "@/lib/passkey-route";

export async function POST(req: Request) {
  const checked = await readPasskeyPostBody(req, "register-options");
  if ("response" in checked) return checked.response;
  if (!parsePasskeyBody(checked.text)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const observer = await currentObserver();
  try {
    return NextResponse.json({ options: await registrationOptions(req, observer.id, observer.display_name) });
  } catch {
    return NextResponse.json({ error: "Passkeys aren't available right now. Try again soon." }, { status: 503 });
  }
}
