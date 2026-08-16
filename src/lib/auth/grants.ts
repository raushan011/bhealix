import { usesFieldPanel, type Role } from "@/constants/access";
import { GRANTABLE_WORKSPACES, isGrantable, type GrantableWorkspace, type Workspace } from "@/lib/workspace";

/**
 * The rules about who may enter which CRM, with nothing else in them.
 *
 * Free of Mongoose and of React on purpose. These four functions are the actual
 * policy — the fallback for an account nobody has decided about, the refusal
 * that keeps the super admin panel out of anybody's grant, the exemption for
 * field staff — and every one of them is a sentence worth a test that does not
 * need a database to run. `lib/auth/access` is the half that goes and reads the
 * decision; this is the half that interprets it.
 */

/**
 * What a role has always been able to reach, for accounts nobody has decided
 * about yet.
 *
 * These are exactly the panels each role could open before grants existed —
 * `can.viewSales` let the administrator and HR into the affiliate side, and
 * everybody at a desk could open the doctor one. Shipping this feature therefore
 * changed nothing for anybody until a super administrator actually withdrew
 * something.
 */
export const DEFAULT_WORKSPACES: Record<Role, readonly GrantableWorkspace[]> = {
  SUPERADMIN: GRANTABLE_WORKSPACES,
  ADMIN: GRANTABLE_WORKSPACES,
  HR: GRANTABLE_WORKSPACES,
  // Field staff have one panel and it is not one of these. They never reach a
  // chooser and the access screen does not list them.
  MR: [],
  SALES: []
};

/** The grant as it is stored: an explicit decision, or nobody has taken one. */
export type StoredGrant = readonly GrantableWorkspace[] | undefined;

/**
 * The stored decision turned into the list actually in force.
 *
 * Absent falls back to the role, present is obeyed, and anything unrecognised
 * that has found its way into the array is dropped rather than trusted. The
 * result is put back into the canonical order so that two screens listing the
 * same person's panels never disagree about which comes first.
 */
export function grantedWorkspaces(role: Role, stored: StoredGrant): GrantableWorkspace[] {
  const chosen: readonly unknown[] = Array.isArray(stored) ? stored : DEFAULT_WORKSPACES[role];
  return GRANTABLE_WORKSPACES.filter(workspace => chosen.includes(workspace) && isGrantable(workspace));
}

/**
 * Whether this account may open this panel.
 *
 * Three rules, in order of how absolute they are:
 *
 * 1. **The super admin panel is the role, never a grant.** Nothing on the access
 *    screen can turn it on, which is what stops an administrator granting
 *    themselves the screen that hands out grants.
 * 2. **Field roles hold no panel here.** A rep has one panel and it is not one
 *    of these; the desk guard has already sent them to it by the time this is
 *    asked.
 * 3. Otherwise, what they were granted.
 */
export function mayEnter(role: Role, stored: StoredGrant, workspace: Workspace): boolean {
  if (workspace === "control") return role === "SUPERADMIN";
  if (usesFieldPanel(role)) return false;
  return grantedWorkspaces(role, stored).includes(workspace);
}

/** Every panel this account can open, the super admin one included. */
export function panelsFor(role: Role, stored: StoredGrant): Workspace[] {
  const panels: Workspace[] = usesFieldPanel(role) ? [] : [...grantedWorkspaces(role, stored)];
  if (role === "SUPERADMIN") panels.push("control");
  return panels;
}
