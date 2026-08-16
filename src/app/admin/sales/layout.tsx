import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { WORKSPACE_HOME } from "@/lib/workspace";

/**
 * The affiliate CRM's own door.
 *
 * The sidebar already hides what a role cannot use, but hiding a link is not a
 * permission (§4.8) — somebody typing the address, or following an old
 * bookmark, has to be turned away by the server. The routes underneath guard
 * themselves as well; this is what stops a screen rendering at all.
 *
 * Two questions now, not one. `can.viewSales` asks whether the *job* includes
 * the affiliate side at all; `requireWorkspace` asks whether this particular
 * person has been given it, which a super administrator decides and can take
 * back. Both have to say yes, and the grant is asked first so that somebody
 * whose panel was withdrawn is sent to one they still hold rather than bounced
 * into the Doctor CRM they may also have lost.
 */
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const session = await requireWorkspace("sales");
  if (!can.viewSales(session.role)) redirect(WORKSPACE_HOME.doctor);
  return <>{children}</>;
}
