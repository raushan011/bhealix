import { Types } from "mongoose";
import { can, usesExecutivePanel } from "@/constants/access";
import type { Session } from "@/lib/auth/session";

/**
 * Who may see which part of the sales team's records.
 *
 * Two audiences and one rule each. A sales executive sees their own orders, their
 * own incentives and the leads handed to them — never a colleague's, because
 * the incentive table is everybody's pay. The desk, with `viewSalesTeam`, sees
 * all of it. Ownership is decided here rather than in each route, so that no
 * route can forget it (§4.8: role and ownership are separate checks).
 */

/** The filter that keeps a query to what this person may read, or null when they may read none of it. */
export function orderScope(session: Session): Record<string, unknown> | null {
  if (usesExecutivePanel(session.role)) return { executive: new Types.ObjectId(session.userId) };
  return can.viewSalesTeam(session.role) ? {} : null;
}

/** The same for leads: an executive sees what was assigned to them. */
export function leadScope(session: Session): Record<string, unknown> | null {
  if (usesExecutivePanel(session.role)) return { assignedTo: new Types.ObjectId(session.userId) };
  return can.viewSalesTeam(session.role) ? {} : null;
}

/** Whether this person may act on (not just read) an order belonging to `executive`. */
export function mayActOn(session: Session, executive: unknown): boolean {
  if (!can.placeSalesOrder(session.role)) return false;
  return usesExecutivePanel(session.role) ? String(executive) === session.userId : true;
}

export const isExecutive = (session: Session) => usesExecutivePanel(session.role);
