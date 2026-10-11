import "server-only";
import { cookies } from "next/headers";
import { getOrCreateObserver } from "./store";

const COOKIE = "aeye_obs";

/**
 * Anonymous observer identity kept in a cookie. Stands in for Supabase magic-link
 * auth until milestone 1 lands. Route handlers only (it may set a cookie).
 */
export async function currentObserver() {
  const jar = await cookies();
  const obs = getOrCreateObserver(jar.get(COOKIE)?.value);
  if (jar.get(COOKIE)?.value !== obs.id) {
    jar.set(COOKIE, obs.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return obs;
}

/** Read-only lookup for Server Components. */
export async function peekObserverId() {
  return (await cookies()).get(COOKIE)?.value;
}
