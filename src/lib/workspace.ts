/**
 * The CRMs that share the desk panel.
 *
 * One application, three operations that barely touch: the **Doctor CRM** is the
 * field business — discovery, call planning, visits, the trade billing and the
 * people behind it — the **Sales CRM** is the affiliate business, where
 * strangers sell online with a coupon code and are paid a share of what arrives,
 * and the **Super admin** panel is neither, being the place the other two are
 * granted from and the place the company's own purchase paper is filed. A single
 * sidebar holding all of it read as thirty unrelated links.
 *
 * There is deliberately **no stored preference**. Which CRM you are in is
 * decided by the path you are on, so a bookmark, a link in an email and the back
 * button all land somewhere that agrees with itself. A cookie would eventually
 * disagree with the URL, and the sidebar would describe a different application
 * from the one on screen.
 *
 * Pure — the shell, the guards, the chooser and the API all read the same answer.
 */

export const WORKSPACES = ["doctor", "sales", "control"] as const;
export type Workspace = (typeof WORKSPACES)[number];

/**
 * The two that can be handed out.
 *
 * `control` is not on this list and never will be: it is the panel that does the
 * handing out, so an account that could be granted it could grant itself
 * anything. It comes with the `SUPERADMIN` role or not at all.
 */
export const GRANTABLE_WORKSPACES = ["doctor", "sales"] as const;
export type GrantableWorkspace = (typeof GRANTABLE_WORKSPACES)[number];

export const isGrantable = (value: unknown): value is GrantableWorkspace =>
  (GRANTABLE_WORKSPACES as readonly unknown[]).includes(value);

export const WORKSPACE_LABEL: Record<Workspace, string> = {
  doctor: "Doctor CRM",
  sales: "Sales CRM",
  control: "Super admin"
};

/**
 * The one place the businesses are described side by side, so it is also the
 * place to be explicit about who works in each.
 *
 * A **field sales executive** is staff in the Doctor CRM — on the payroll,
 * marked present, working a round of clinics. A **sales partner** is an outsider
 * in the Sales CRM — no employment, paid a commission on what their coupon
 * brought in. Both used to be called "sales", which made two entirely separate
 * businesses look like one confused one.
 */
export const WORKSPACE_BLURB: Record<Workspace, string> = {
  doctor: "Doctor discovery, call planning, field visits, billing, and the employees who do it — including field sales executives.",
  sales: "Outside partners selling with their own coupon codes: sign-ups, Shopify orders, delivery status and commission payouts.",
  control: "Who may enter which CRM, and the vendor invoice vault — every bill Shiprocket, Razorpay, Shopify and Meta sent this company, by month, ready for the accountant."
};

export const WORKSPACE_HOME: Record<Workspace, string> = {
  doctor: "/admin",
  sales: "/admin/sales",
  control: "/admin/control"
};

/** The chooser shown after a desk role signs in. */
export const CHOOSE_PATH = "/choose";

/**
 * Which CRM a path belongs to. Total by construction: everything else is the
 * Doctor CRM, which is the panel `/admin` itself opens on.
 *
 * Order matters. `/admin/sales` and `/admin/control` are both inside `/admin`,
 * so they have to be asked about first or every page in the application would
 * answer "doctor".
 */
export function workspaceOf(pathname: string): Workspace {
  for (const workspace of ["control", "sales"] as const) {
    const home = WORKSPACE_HOME[workspace];
    if (pathname === home || pathname.startsWith(`${home}/`)) return workspace;
  }
  return "doctor";
}

/**
 * The same question asked of an API path, which is the half a panel guard cannot
 * answer: a page is protected by the layout above it, and a route handler has no
 * layout at all.
 *
 * `null` rather than a default, and that distinction is the whole point. Most of
 * this API belongs to no CRM in particular — signing in, reading your own
 * payslip, an affiliate's own portal — and answering "doctor" for those would
 * lock somebody out of their own password change because a panel they never use
 * was withdrawn. Only the paths that plainly belong to one CRM name it.
 *
 * `/api/finance` is deliberately absent: the vault is guarded by the role, which
 * cannot be granted or withdrawn from the access screen at all.
 */
export function apiWorkspaceOf(pathname: string): Workspace | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === "/api/sales" || path.startsWith("/api/sales/")) return "sales";

  for (const prefix of DOCTOR_API_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return "doctor";
  }
  return null;
}

/**
 * The Doctor CRM's own API surface, named rather than inferred.
 *
 * Every one of these is also used by the field panel on a phone, where the grant
 * has no meaning — a rep is not given panels, they have exactly one. The guard
 * that reads this list exempts field roles for that reason; what it stops is a
 * desk account whose Doctor CRM has been withdrawn calling the routes behind it
 * directly, which is otherwise the obvious way round a sidebar that no longer
 * shows the links.
 */
const DOCTOR_API_PREFIXES = [
  "/api/doctors", "/api/visits", "/api/plans", "/api/reports", "/api/customers",
  "/api/invoices", "/api/billing", "/api/inventory", "/api/products", "/api/samples",
  "/api/hr", "/api/team", "/api/google"
] as const;
