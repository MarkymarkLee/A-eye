import { NextResponse } from "next/server";
import { loginOptions } from "@/lib/passkey";
import { parsePasskeyBody, readPasskeyPostBody } from "@/lib/passkey-route";

export async function POST(req: Request) {
  const checked = await readPasskeyPostBody(req, "login-options");
  if ("response" in checked) return checked.response;
  if (!parsePasskeyBody(checked.text)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    return NextResponse.json({ options: await loginOptions(req) });
  } catch {
    return NextResponse.json({ error: "Passkeys aren't available right now. Try again soon." }, { status: 503 });
  }
}
