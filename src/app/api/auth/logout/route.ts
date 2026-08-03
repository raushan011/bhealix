import { cookies } from "next/headers";
import { ok } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  return ok({ signedOut: true });
}
