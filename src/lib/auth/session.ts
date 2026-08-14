import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import type { Role } from "@/constants/access";

export const SESSION_COOKIE = "bhealix_session";
export type Session = { userId: string; name: string; role: Role };

const secret = () => {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not configured");
  return new TextEncoder().encode(value);
};

export async function createSessionToken(session: Session) {
  return new SignJWT({ userId: session.userId, name: session.name, role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !process.env.AUTH_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, secret());

    /*
     * An affiliate's token is never a staff session, whatever cookie it arrives
     * in.
     *
     * The two are already separated by cookie name, so this only matters if
     * somebody copies one value into the other's slot — but the whole reason
     * affiliates were kept out of `User` is that they are outsiders, and a
     * guarantee that rests on a cookie name is a guarantee that rests on
     * nothing. Both halves are checked, and the partner verifier requires this
     * audience just as firmly as this one refuses it.
     */
    if (payload.aud === "partner") return null;

    // Tokens issued before `name` existed carry no name. Leave it empty so the
    // caller can look it up — String(undefined) would render as "undefined".
    return {
      userId: String(payload.userId),
      name: typeof payload.name === "string" ? payload.name : "",
      role: payload.role as Role
    };
  } catch {
    return null;
  }
}
