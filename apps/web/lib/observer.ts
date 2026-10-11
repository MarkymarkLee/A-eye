import "server-only";
import { cookies } from "next/headers";
import { cookieSecret, createObserver, getObserver } from "./store";
import { isLegacyObserverId, signObserverId, verifyObserverCookie } from "./observer-cookie";

const COOKIE = "aeye_obs";

/**
 * Anonymous observer identity kept in a cookie. Stands in for Supabase magic-link
 * auth until milestone 1 lands. Route handlers only (it may set a cookie).
 */
export async function currentObserver() {
  const jar = await cookies();
  const secret = cookieSecret();
  const raw = jar.get(COOKIE)?.value;
  const id = verifyObserverCookie(raw, secret) ?? (isLegacyObserverId(raw) ? raw : undefined);
  const obs = (id && getObserver(id)) || createObserver();
  const signed = signObserverId(obs.id, secret);
  if (raw !== signed) {
    jar.set(COOKIE, signed, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return obs;
}

/** Read-only lookup for Server Components. */
export async function peekObserverId() {
  const raw = (await cookies()).get(COOKIE)?.value;
  return verifyObserverCookie(raw, cookieSecret()) ?? (isLegacyObserverId(raw) ? raw : undefined);
}
