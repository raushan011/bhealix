/**
 * The CRMs that share the desk panel.
 *
 * One application, several operations that barely touch:
 *
 * - the **Doctor CRM** — discovery, call planning, visits and the trade billing;
 * - **HR & Employees** — every employee's record, login, salary, attendance,
 *   leave and payroll, whichever CRM they work in;
 * - the **Leads CRM** — prospecting, the retargeting list and the automated
 *   WhatsApp outreach that works both;
 * - the **Sales CRM** — the employed sales executives who are handed those
 *   leads, place orders, book them with Shiprocket and earn an incentive;
 * - the **Affiliate CRM** — outsiders selling on commission with a coupon code;
 * - and the **Super admin** panel, which is none of these, being the place the
 *   others are granted from and the place the company's purchase paper is filed.
 *
 * The Leads, Affiliate and Sales screens used to be one "Sales CRM", built when
 * the only people selling were affiliates. Once the company hired its own sales
 * team, one sidebar was describing three jobs done by three different groups of
 * people, so it was split along the lines of who actually does the work.
 *
 * There is deliberately **no stored preference**. Which CRM you are in is
 * decided by the path you are on, so a bookmark, a link in an email and the back
 * button all land somewhere that agrees with itself.
 *
 * Pure — the shell, the guards, the chooser and the API all read the same answer.
 */

export const WORKSPACES = ["doctor", "people", "leads", "sales", "affiliate", "control"] as const;
export type Workspace = (typeof WORKSPACES)[number];

/**
 * The ones that can be handed out.
 *
 * `control` is not on this list and never will be: it is the panel that does the
 * handing out, so an account that could be granted it could grant itself
 * anything. It comes with the `SUPERADMIN` role or not at all.
 */
export const GRANTABLE_WORKSPACES = ["doctor", "people", "leads", "sales", "affiliate"] as const;
export type GrantableWorkspace = (typeof GRANTABLE_WORKSPACES)[number];

export const isGrantable = (value: unknown): value is GrantableWorkspace =>
  (GRANTABLE_WORKSPACES as readonly unknown[]).includes(value);

export const WORKSPACE_LABEL: Record<Workspace, string> = {
  doctor: "Doctor CRM",
  people: "HR & Employees",
  leads: "Leads CRM",
  sales: "Sales CRM",
  affiliate: "Affiliate CRM",
  control: "Super admin"
};

/**
 * The one place the businesses are described side by side, so it is also the
 * place to be explicit about who works in each.
 *
 * A **sales executive** is staff in the Sales CRM — on the payroll, handed leads,
 * paid a salary plus an incentive on what they deliver. A **sales partner** is an
 * outsider in the Affiliate CRM — no employment, paid a commission on what their
 * coupon brought in. A **field sales executive** is staff in the Doctor CRM,
 * working a round of clinics.
 */
export const WORKSPACE_BLURB: Record<Workspace, string> = {
  doctor: "Doctor discovery, call planning, field visits, trade billing, stock and samples.",
  people: "Every employee in one place — their record, login, salary, attendance, leave and payroll.",
  leads: "Find and keep leads, ring back past customers, and the WhatsApp outreach that runs on its own.",
  sales: "Your sales executives: the leads they are given, the orders they place and ship, and the incentive each one earns.",
  affiliate: "Outside partners selling with their own coupon codes: sign-ups, Shopify orders, delivery status and paying each delivered order's commission.",
  control: "Who may enter which CRM, and the vendor invoice vault — every bill Shiprocket, Razorpay, Shopify and Meta sent this company, by month, ready for the accountant."
};

export const WORKSPACE_HOME: Record<Workspace, string> = {
  doctor: "/admin",
  people: "/admin/hr",
  leads: "/admin/leads",
  sales: "/admin/sales",
  affiliate: "/admin/affiliate",
  control: "/admin/control"
};

/**
 * The page prefixes each panel owns beyond its home.
 *
 * HR & Employees keeps the addresses it always had — `/admin/hr` and
 * `/admin/team` — so that every bookmark and every link into a payslip still
 * lands; it simply answers to its own panel now rather than to the Doctor CRM.
 */
const PAGE_PREFIXES: [Workspace, string[]][] = [
  ["control", ["/admin/control"]],
  ["people", ["/admin/hr", "/admin/team"]],
  ["leads", ["/admin/leads"]],
  ["sales", ["/admin/sales"]],
  ["affiliate", ["/admin/affiliate"]]
];

/** The chooser shown after a desk role signs in. */
export const CHOOSE_PATH = "/choose";

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Which CRM a path belongs to. Total by construction: everything else is the
 * Doctor CRM, which is the panel `/admin` itself opens on.
 *
 * Matched on whole segments, so `/admin/salespeople` is not the Sales CRM.
 */
export function workspaceOf(pathname: string): Workspace {
  for (const [workspace, prefixes] of PAGE_PREFIXES) {
    if (prefixes.some(prefix => under(pathname, prefix))) return workspace;
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
 * `/api/team` is deliberately absent too. It is the list of colleagues, and every
 * CRM needs it — the Doctor CRM to assign a round, the Sales CRM to hand over a
 * lead — so withdrawing HR from somebody must not stop them picking a person.
 * Its writes are guarded by `can.manageEmployees` regardless.
 */
export function apiWorkspaceOf(pathname: string): Workspace | null {
  const path = pathname.replace(/\/+$/, "");
  if (under(path, "/api/sales-team")) return "sales";
  if (LEADS_API_PREFIXES.some(prefix => under(path, prefix))) return "leads";
  if (under(path, "/api/sales")) return "affiliate";
  if (under(path, "/api/hr")) return "people";

  for (const prefix of DOCTOR_API_PREFIXES) {
    if (under(path, prefix)) return "doctor";
  }
  return null;
}

/** The affiliate API's corner that now belongs to the Leads CRM. */
const LEADS_API_PREFIXES = [
  "/api/sales/leads", "/api/sales/retarget", "/api/sales/automation", "/api/sales/templates"
] as const;

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
  "/api/google"
] as const;

/**
 * The only API a sales executive may call at all.
 *
 * An allowlist rather than a list of refusals, and the reason is how the rest of
 * the API was written. Dozens of routes say "a field rep sees their own, anybody
 * else sees everything" — which was a complete rule while every role was either
 * a field rep or somebody at the desk. A sales executive is neither, so every one
 * of those routes would hand them the whole company's visits, bills and samples.
 * Rather than trust forty call sites to have thought of a role that did not exist
 * when they were written, the executive is held to the handful of routes built
 * for them, plus their own account and their own leave.
 */
const EXECUTIVE_API_PREFIXES = ["/api/auth", "/api/sales-team", "/api/hr/leave"] as const;

export const executiveMayCall = (pathname: string) => {
  const path = pathname.replace(/\/+$/, "");
  return EXECUTIVE_API_PREFIXES.some(prefix => under(path, prefix));
};
