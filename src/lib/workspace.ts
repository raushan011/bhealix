/**
 * The two CRMs that share the desk panel.
 *
 * One application, two operations that barely touch: the **Doctor CRM** is the
 * field business — discovery, call planning, visits, the trade billing and the
 * people behind it — and the **Sales CRM** is the affiliate business, where
 * strangers sell online with a coupon code and are paid a share of what arrives.
 * They share an administrator and nothing else, and a single sidebar holding
 * both read as twenty unrelated links.
 *
 * There is deliberately **no stored preference**. Which CRM you are in is
 * decided by the path you are on, so a bookmark, a link in an email and the back
 * button all land somewhere that agrees with itself. A cookie would eventually
 * disagree with the URL, and the sidebar would describe a different application
 * from the one on screen.
 *
 * Pure — the shell, the guards and the chooser all read the same answer.
 */

export const WORKSPACES = ["doctor", "sales"] as const;
export type Workspace = (typeof WORKSPACES)[number];

export const WORKSPACE_LABEL: Record<Workspace, string> = {
  doctor: "Doctor CRM",
  sales: "Sales CRM"
};

/**
 * The one place the two businesses are described side by side, so it is also
 * the place to be explicit about who works in each.
 *
 * A **field sales executive** is staff in the Doctor CRM — on the payroll,
 * marked present, working a round of clinics. A **sales partner** is an outsider
 * in the Sales CRM — no employment, paid a commission on what their coupon
 * brought in. Both used to be called "sales", which made two entirely separate
 * businesses look like one confused one.
 */
export const WORKSPACE_BLURB: Record<Workspace, string> = {
  doctor: "Doctor discovery, call planning, field visits, billing, and the employees who do it — including field sales executives.",
  sales: "Outside partners selling with their own coupon codes: sign-ups, Shopify orders, delivery status and commission payouts."
};

export const WORKSPACE_HOME: Record<Workspace, string> = {
  doctor: "/admin",
  sales: "/admin/sales"
};

/** The chooser shown after a desk role signs in. */
export const CHOOSE_PATH = "/choose";

/** Which CRM a path belongs to. Total by construction: everything else is the Doctor CRM. */
export const workspaceOf = (pathname: string): Workspace =>
  pathname === WORKSPACE_HOME.sales || pathname.startsWith(`${WORKSPACE_HOME.sales}/`) ? "sales" : "doctor";
