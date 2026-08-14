import { clearPartnerCookie } from "@/lib/auth/partner";
import { ok } from "@/lib/api";

/** Drops the affiliate cookie. Never touches the staff one — they are different sessions. */
export async function POST() {
  await clearPartnerCookie();
  return ok({ signedOut: true });
}
