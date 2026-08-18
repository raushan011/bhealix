import { cookies } from "next/headers";
import type { Role } from "@/constants/access";
import { encodeSecret, sessionCookieOptions, signSessionToken, STAFF_COOKIE, verifySession } from "./token";

export const SESSION_COOKIE = STAFF_COOKIE;
export type Session = { userId: string; name: string; role: Role };

const secret = () => {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not configured");
  return encodeSecret(value);
};

/**
 * A fresh sign-in. The token slides from here — see `lib/auth/token.ts` for
 * the two clocks it carries and how the middleware keeps it alive.
 */
export async function createSessionToken(session: Session) {
  return signSessionToken("staff", { userId: session.userId, name: session.name, role: session.role }, secret());
}

/** Writes the cookie. One place, so login and refresh cannot disagree about the flags. */
export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions("staff", process.env.NODE_ENV === "production"));
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !process.env.AUTH_SECRET) return null;

  /*
   * An affiliate's token is never a staff session, whatever cookie it arrives
   * in — `verifySession` refuses the partner audience here just as firmly as
   * the partner verifier requires it. Refreshing is the middleware's job; this
   * only reads, because a page render may not write a cookie.
   */
  const verified = await verifySession("staff", token, secret());
  if (!verified) return null;
  const { payload } = verified;

  // Tokens issued before `name` existed carry no name. Leave it empty so the
  // caller can look it up — String(undefined) would render as "undefined".
  return {
    userId: String(payload.userId),
    name: typeof payload.name === "string" ? payload.name : "",
    role: payload.role as Role
  };
}
