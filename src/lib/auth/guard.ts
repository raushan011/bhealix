import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { homeFor, usesAdminPanel, usesFieldPanel, type Role } from "@/constants/access";
import { apiWorkspaceOf, CHOOSE_PATH, WORKSPACE_HOME, WORKSPACE_LABEL, type Workspace } from "@/lib/workspace";
import { PATH_HEADER } from "@/lib/auth/path-header";
import { sessionMayEnter, storedGrantFor } from "./access";
import { mayEnter, panelsFor } from "./grants";
import { getSession, type Session } from "./session";

/**
 * Sessions issued before the token carried a name have none. Rather than
 * signing those people out, fill the name in from the database so the screen
 * greets them properly until their token is next reissued.
 */
async function withName(session: Session): Promise<Session> {
  if (session.name) return session;
  const { connectDb } = await import("@/lib/db/mongoose");
  const { User } = await import("@/models/User");
  await connectDb();
  const user = await User.findById(session.userId).select("name").lean() as { name?: string } | null;
  return { ...session, name: user?.name ?? "there" };
}

/** For pages: guarantees a session, sending anyone signed out to the login screen. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return withName(session);
}

/** For pages under /admin — desk roles only; field staff are sent to their own panel. */
export async function requireAdminPanel(): Promise<Session> {
  const session = await requireSession();
  if (!usesAdminPanel(session.role)) redirect(homeFor(session.role));
  return session;
}

/** For pages under /employee — field roles only. */
export async function requireFieldPanel(): Promise<Session> {
  const session = await requireSession();
  if (!usesFieldPanel(session.role)) redirect(homeFor(session.role));
  return session;
}

/**
 * For pages inside one of the CRMs: a desk session that has actually been
 * granted this one.
 *
 * Somebody whose Sales CRM was withdrawn is sent to a panel they still hold
 * rather than to a refusal, because the ordinary case for landing here is a
 * stale bookmark rather than an attempt on anything — and if they hold nothing
 * at all, the chooser is the screen that explains it.
 */
export async function requireWorkspace(workspace: Workspace): Promise<Session> {
  const session = await requireAdminPanel();
  const grant = await storedGrantFor(session.userId);
  if (mayEnter(session.role, grant, workspace)) return session;

  const [fallback] = panelsFor(session.role, grant);
  redirect(fallback && fallback !== workspace ? WORKSPACE_HOME[fallback] : CHOOSE_PATH);
}

/**
 * For API routes: returns the session, or a Response to return immediately.
 * Route handlers stay readable: `const auth = await apiSession(); if ("response" in auth) return auth.response;`
 *
 * The CRM grant is checked here too, and without a single route handler having
 * to ask for it. Which CRM a route belongs to is a property of its path
 * (`apiWorkspaceOf`), and the path arrives on a header the middleware sets on
 * every `/api` request — so a panel withdrawn on the access screen closes the
 * routes behind it in the same breath as the links to them, rather than leaving
 * a sidebar that hides what a `fetch` can still reach.
 *
 * A path that belongs to no CRM in particular — signing in, your own payslip, an
 * affiliate's own portal — is left to its role check alone, which is what it had
 * before and what it should keep.
 */
export async function apiSession(allow?: (role: Role) => boolean):
  Promise<{ session: Session } | { response: Response }> {
  const session = await getSession();
  if (!session) return { response: Response.json({ error: "Please sign in again" }, { status: 401 }) };
  if (allow && !allow(session.role)) return { response: Response.json({ error: "You do not have access to this action" }, { status: 403 }) };

  const workspace = apiWorkspaceOf((await headers()).get(PATH_HEADER) ?? "");
  if (workspace && usesAdminPanel(session.role) && !await sessionMayEnter(session, workspace)) {
    return { response: Response.json(
      { error: `Your access to the ${WORKSPACE_LABEL[workspace]} has been withdrawn. Ask a super administrator to restore it.` },
      { status: 403 }
    ) };
  }

  return { session };
}
