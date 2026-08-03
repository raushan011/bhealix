import { redirect } from "next/navigation";
import { homeFor, usesAdminPanel, usesFieldPanel, type Role } from "@/constants/access";
import { getSession, type Session } from "./session";

/** For pages: guarantees a session, sending anyone signed out to the login screen. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
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
 * For API routes: returns the session, or a Response to return immediately.
 * Route handlers stay readable: `const auth = await apiSession(); if ("response" in auth) return auth.response;`
 */
export async function apiSession(allow?: (role: Role) => boolean):
  Promise<{ session: Session } | { response: Response }> {
  const session = await getSession();
  if (!session) return { response: Response.json({ error: "Please sign in again" }, { status: 401 }) };
  if (allow && !allow(session.role)) return { response: Response.json({ error: "You do not have access to this action" }, { status: 403 }) };
  return { session };
}
