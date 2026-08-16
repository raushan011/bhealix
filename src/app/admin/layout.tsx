import { headers } from "next/headers";
import { AdminShell } from "@/components/layout/admin-shell";
import { panelsForSession } from "@/lib/auth/access";
import { requireAdminPanel, requireWorkspace } from "@/lib/auth/guard";
import { PATH_HEADER } from "@/lib/auth/path-header";
import { workspaceOf } from "@/lib/workspace";

/**
 * The desk panel, and the first place the CRM grant is checked.
 *
 * The check belongs *here*, at the top, rather than only in the three layouts
 * underneath — and the reason is what a redirect costs once rendering has
 * started. A `redirect()` thrown in a nested layout runs after this one has
 * begun streaming, at which point Next can no longer answer with a 307 and falls
 * back to embedding a one-second meta refresh: somebody sent away from a
 * withdrawn panel sits looking at its sidebar first, which reads as though they
 * got in and were then thrown out. Deciding before anything renders makes it an
 * ordinary redirect with nothing drawn.
 *
 * The path comes off the header the middleware stamps, because a layout is never
 * told which route it is wrapping. The per-panel layouts still name their own
 * workspace, so the guard does not rest on that header alone — and the grant
 * itself is read once per request and memoised, so asking twice costs one query.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get(PATH_HEADER);
  const session = path ? await requireWorkspace(workspaceOf(path)) : await requireAdminPanel();

  /*
   * Resolved here rather than in the shell because the shell runs in the browser
   * and the answer is in the database. This layout wraps all three CRMs, so it
   * is the only place that sees every one of them: the guard above decides
   * whether *this* panel may be opened, and this decides what the sidebar is
   * allowed to offer as an alternative.
   */
  const panels = await panelsForSession(session);
  return <AdminShell user={{ name: session.name, role: session.role }} panels={panels}>{children}</AdminShell>;
}
