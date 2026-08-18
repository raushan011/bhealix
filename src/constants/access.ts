export const ROLES = ["SUPERADMIN", "ADMIN", "HR", "MR", "SALES"] as const;
export type Role = (typeof ROLES)[number];

/**
 * What each role is called on screen.
 *
 * `SALES` is **field sales executive**, and the word "field" is doing real work
 * there rather than decorating. This application runs two businesses that both
 * use the word "sales": the doctor operation, where a sales executive is an
 * employee on the payroll working a round of clinics, and the affiliate
 * operation, where a *sales partner* is an outsider selling online with a
 * coupon code. They share no record, no panel and no login — see
 * `models/Sales.ts` — and calling both of them "sales rep" on screen was how
 * that separation stopped being obvious to anybody reading it.
 */
export const ROLE_LABEL: Record<Role, string> = {
  SUPERADMIN: "Super administrator",
  ADMIN: "Administrator",
  HR: "HR",
  MR: "Medical representative",
  SALES: "Field sales executive"
};

/**
 * The super administrator is an administrator and then some.
 *
 * Every permission below that reads `role === "ADMIN"` means "has the
 * administrator's authority", and the super administrator has all of it —
 * writing the two out at each of forty call sites would eventually miss one,
 * and a permission that silently excludes the most senior account is a bug
 * nobody reports because it looks like a policy.
 *
 * What is *only* theirs is named separately at the bottom: granting other
 * people their panels, and the vendor invoice vault.
 */
const admin = (role: Role) => role === "ADMIN" || role === "SUPERADMIN";

/**
 * The roles the Employees screen is allowed to hand out.
 *
 * Everything except `SUPERADMIN`, and that omission is the whole security model
 * of this role rather than a tidiness preference. Adding a role to `ROLES` puts
 * it in a `z.enum` on two API routes and a `<select>` on two forms — all four
 * reached by `can.manageEmployees`, which is **ADMIN or HR**. Left on that list,
 * any administrator could create a super administrator, or promote themselves
 * to one, and the account whose entire purpose is to be above them would be
 * something they could mint at will.
 *
 * A super administrator is made from a shell (`scripts/make-super-admin.mjs`)
 * and nowhere else. Shell access to the deployment is the right bar for the
 * account that hands out everybody's access.
 */
export const ASSIGNABLE_ROLES = ROLES.filter(role => role !== "SUPERADMIN") as Exclude<Role, "SUPERADMIN">[];

/**
 * Whether this person may edit that account at all.
 *
 * A super administrator's record is off limits to everybody below them — not
 * only their role. An administrator who could set their password could sign in
 * as them; one who could deactivate or delete them could remove the only account
 * able to restore anybody's access, with no way back through the interface. So
 * the whole record is closed, and only another super administrator may touch it.
 */
export const mayEditAccount = (actor: Role, target: Role) =>
  target !== "SUPERADMIN" || actor === "SUPERADMIN";

/** SUPERADMIN, ADMIN and HR work at a desk; MR and SALES work from a phone in the field. */
export const usesAdminPanel = (role: Role) => admin(role) || role === "HR";
export const usesFieldPanel = (role: Role) => role === "MR" || role === "SALES";
export const homeFor = (role: Role) => (usesAdminPanel(role) ? "/admin" : "/employee");

/**
 * Where somebody lands when they sign in, as opposed to where a panel guard
 * sends them when they wander.
 *
 * The desk serves two CRMs — the doctor operation and the affiliate one — so a
 * desk role is asked which they came for. Field staff have one panel and are
 * taken straight to it; asking them to choose would be a question with one
 * answer. Kept apart from `homeFor` on purpose: a guard bouncing a rep out of
 * `/admin` wants the panel, not the chooser.
 */
export const landingFor = (role: Role) => (usesAdminPanel(role) ? "/choose" : "/employee");

export const can = {
  manageDoctors: (role: Role) => admin(role),
  manageEmployees: (role: Role) => admin(role) || role === "HR",
  /**
   * Building a plan for somebody else, and assigning it. A rep plans their own
   * day under `planOwnRoute` — that is a different thing and needs no authority
   * over anyone.
   */
  planRoutes: (role: Role) => admin(role),
  /** A rep decides their own round, so they build and keep their own plan. */
  planOwnRoute: (role: Role) => usesFieldPanel(role),
  /**
   * Adding a doctor to the directory. Field staff meet doctors the office has
   * never heard of, so they may add them — the directory grows where the work
   * actually happens. Editing and archiving stay with the administrator.
   */
  addDoctors: (role: Role) => admin(role) || usesFieldPanel(role),
  viewAllReports: (role: Role) => admin(role),
  logVisits: (role: Role) => usesFieldPanel(role),
  /** Field staff learn the real call timing from the doctor, so they may correct it. */
  updateCallTime: (role: Role) => admin(role) || usesFieldPanel(role),
  /** Handing stock to a rep, and correcting the count, is the administrator's call. */
  issueSamples: (role: Role) => admin(role),
  /** HR reads the stock position but does not move any. */
  viewAllStock: (role: Role) => admin(role) || role === "HR",

  /** Raising, cancelling and deleting an invoice is the administrator's alone. */
  manageBilling: (role: Role) => admin(role),
  /** HR sees the collection position without being able to change a bill. */
  viewAllBilling: (role: Role) => admin(role) || role === "HR",
  /**
   * The rep is the one standing in the clinic when the doctor pays, so they may
   * record a receipt — but only against an invoice raised in their own name,
   * and recording a receipt can never alter what was billed.
   */
  recordPayment: (role: Role) => admin(role) || usesFieldPanel(role),
  /** Receiving stock and correcting the warehouse count. */
  manageInventory: (role: Role) => admin(role),

  // ------------------------------------------------------------------ people
  /** The HR desk: employee records, attendance and leave. */
  viewHr: (role: Role) => admin(role) || role === "HR",
  /** Marking a day present or absent, and correcting one already marked. */
  manageAttendance: (role: Role) => admin(role) || role === "HR",
  /** Approving or refusing somebody's leave. Never their own — checked on the server. */
  manageLeave: (role: Role) => admin(role) || role === "HR",
  /** Everybody works, so everybody can ask for time off. */
  applyLeave: () => true,

  // ----------------------------------------------------------------- payroll
  /**
   * Setting what somebody is paid and preparing a month's payroll. The HR desk's
   * own work: they hold the employment record, the attendance and the leave that
   * the figures are built from.
   */
  runPayroll: (role: Role) => admin(role) || role === "HR",
  /**
   * Approving a run and releasing the money.
   *
   * Deliberately not the same authority as preparing one. Payroll is the largest
   * payment a company makes every month, and one person who can both raise the
   * figures and release them is the oldest hole in any set of books. HR prepares;
   * the administrator approves.
   */
  approvePayroll: (role: Role) => admin(role),
  /** Reading what somebody else earns. Everybody may read their own payslip. */
  viewPayroll: (role: Role) => admin(role) || role === "HR",

  // ------------------------------------------------------------ affiliate sales
  /**
   * Reading the affiliate operation: who is selling, what their coupons brought
   * in, what was delivered and what is owed. HR sees it because they are the
   * desk that answers "when am I being paid" on the telephone.
   */
  viewSales: (role: Role) => admin(role) || role === "HR",
  /**
   * Adding a rep, issuing them a coupon, correcting a delivery the courier got
   * wrong, and holding the Shopify and Shiprocket credentials.
   *
   * The administrator's alone. A coupon code *is* an attribution rule — whoever
   * can issue one can direct commission at a person — and correcting a delivery
   * state by hand is the manual override on whether an order pays out at all.
   */
  manageSales: (role: Role) => admin(role),
  /**
   * Booking an order with the courier, choosing who carries it, and printing its
   * invoice and label.
   *
   * Deliberately **not** `manageSales`. Everything that permission guards decides
   * where money goes — a coupon code attributes commission to a person, a
   * delivery override decides whether an order pays at all — and none of that is
   * true of a parcel. Processing an order books freight and prints paper; it
   * changes no rate, no attribution and no payout. The person who packs the
   * boxes should not need the authority to redirect somebody's commission in
   * order to do it, and the desk that answers "where is my parcel" on the
   * telephone is the desk that should be able to send it.
   */
  processOrders: (role: Role) => admin(role) || role === "HR",
  /**
   * Paying a partner's commission on a delivered order, and marking it paid.
   *
   * There is no batch and no second signature: the money moves by UPI or bank
   * transfer outside this system, one order at a time, and the person who sends
   * it is the person who records that they did. That is a real payment to a
   * real person outside the company, so it stays with the administrator — the
   * desk that watches deliveries can see what is owed without being able to
   * say it has been settled.
   */
  paySalesCommission: (role: Role) => admin(role),

  // -------------------------------------------------------------- super admin
  /**
   * Deciding which CRMs somebody may enter.
   *
   * The one authority an ordinary administrator deliberately does not have. An
   * administrator who could widen their own access has no access limit at all,
   * and the whole point of granting panels per person is that somebody above
   * them decides. Held by `SUPERADMIN` and nobody else.
   */
  manageAccess: (role: Role) => role === "SUPERADMIN",
  /**
   * The vendor invoice vault: what Shiprocket, Razorpay, Shopify and Meta
   * billed *this* company, gathered in one place for the accountant.
   *
   * Not `viewAllBilling`, which is the other direction entirely — that is money
   * owed to the company by doctors. This is the company's own purchase paper,
   * the GST input credit sits on it, and it is the file handed to the CA at the
   * end of the month. It stays with the account that answers for the books.
   */
  viewFinance: (role: Role) => role === "SUPERADMIN",
  /** Filing an invoice, correcting one, deleting one, closing a month. */
  manageFinance: (role: Role) => role === "SUPERADMIN"
};
