import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import type { Role, Permission } from "@/constants/access";
export type Session = { userId: string; role: Role; permissions: Permission[] };
const key = () => new TextEncoder().encode(process.env.AUTH_SECRET);
export async function createSessionToken(session: Session) {
  const payload = {
    userId: String(session.userId),
    role: String(session.role),
    permissions: Array.from(session.permissions ?? [], permission => String(permission))
  };
  return new SignJWT(payload).setProtectedHeader({ alg:"HS256" }).setIssuedAt().setExpirationTime("8h").sign(key());
}
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get("bhealix_session")?.value;
  if (!token || !process.env.AUTH_SECRET) return null;
  try { const { payload } = await jwtVerify(token, key()); return payload as unknown as Session; } catch { return null; }
}
