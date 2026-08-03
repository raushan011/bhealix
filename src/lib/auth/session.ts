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
