import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { WORKSPACE_HOME } from "@/lib/workspace";
import { SuperAdminSignIn } from "./sign-in";

export const dynamic = "force-dynamic";

/**
 * The super administrator's own door.
 *
 * **It is a door, not a lock**, and that distinction is worth being plain about
 * rather than letting somebody assume otherwise. The address is not a secret and
 * knowing it grants nothing: what protects this account is its password and its
 * role, exactly as at `/login`, and the same person can sign in there and reach
 * the same panel through the chooser. Two things it does buy, both real:
 *
 * 1. **One address to remember**, that lands on the control panel rather than on
 *    a chooser — somebody who typed `/super-admin` has already chosen.
 * 2. **A refusal that says what happened.** An ordinary administrator who tries
 *    it is told their account is not a super administrator and pointed at their
 *    own sign-in, rather than being let in and quietly redirected somewhere they
 *    did not ask for.
 *
 * Somebody already signed in is not asked to do it again: a super administrator
 * goes straight through, and anybody else is sent to the panel that is actually
 * theirs. Signed out, the form below is the only thing on the page.
 */
export default async function SuperAdminPage() {
  const session = await getSession();

  if (session?.role === "SUPERADMIN") redirect(WORKSPACE_HOME.control);
  // Signed in as somebody else. Sending them to their own landing beats a form
  // that will refuse the credentials they are already holding.
  if (session) redirect("/choose");

  return <SuperAdminSignIn />;
}
