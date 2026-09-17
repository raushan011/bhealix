import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { landingFor } from "@/constants/access";

/**
 * The root is a signpost, not a page.
 *
 * Signed in, it hands you to your own panel; signed out, to the sign-in screen
 * — so a bookmark on the root keeps working for staff either way, and nobody
 * without an account is shown anything but the door.
 *
 * It renders nothing itself, which is deliberate: one sign-in screen at
 * `/login` means one form, one error path and one place to change it. The
 * public marketing site that used to live here is parked on the
 * `marketing-site` branch, along with a note on putting it back.
 */
export default async function Home() {
  const session = await getSession();
  redirect(session ? landingFor(session.role) : "/login");
}
