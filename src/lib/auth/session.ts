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
    return { userId: String(payload.userId), name: String(payload.name), role: payload.role as Role };
  } catch {
    return null;
  }
}
