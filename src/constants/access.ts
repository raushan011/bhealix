export const ROLES = ["ADMIN", "HR", "MR", "SALES"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrator",
  HR: "HR",
  MR: "Medical representative",
  SALES: "Sales executive"
};

/** ADMIN and HR work at a desk; MR and SALES work from a phone in the field. */
export const usesAdminPanel = (role: Role) => role === "ADMIN" || role === "HR";
export const usesFieldPanel = (role: Role) => role === "MR" || role === "SALES";
export const homeFor = (role: Role) => (usesAdminPanel(role) ? "/admin" : "/employee");

export const can = {
  manageDoctors: (role: Role) => role === "ADMIN",
  manageEmployees: (role: Role) => role === "ADMIN" || role === "HR",
  /**
   * Building a plan for somebody else, and assigning it. A rep plans their own
   * day under `planOwnRoute` — that is a different thing and needs no authority
   * over anyone.
   */
  planRoutes: (role: Role) => role === "ADMIN",
  /** A rep decides their own round, so they build and keep their own plan. */
  planOwnRoute: (role: Role) => usesFieldPanel(role),
  /**
   * Adding a doctor to the directory. Field staff meet doctors the office has
   * never heard of, so they may add them — the directory grows where the work
   * actually happens. Editing and archiving stay with the administrator.
   */
  addDoctors: (role: Role) => role === "ADMIN" || usesFieldPanel(role),
  viewAllReports: (role: Role) => role === "ADMIN",
  logVisits: (role: Role) => usesFieldPanel(role),
  /** Field staff learn the real call timing from the doctor, so they may correct it. */
  updateCallTime: (role: Role) => role === "ADMIN" || usesFieldPanel(role),
  /** Handing stock to a rep, and correcting the count, is the administrator's call. */
  issueSamples: (role: Role) => role === "ADMIN",
  /** HR reads the stock position but does not move any. */
  viewAllStock: (role: Role) => role === "ADMIN" || role === "HR",

  /** Raising, cancelling and deleting an invoice is the administrator's alone. */
  manageBilling: (role: Role) => role === "ADMIN",
  /** HR sees the collection position without being able to change a bill. */
  viewAllBilling: (role: Role) => role === "ADMIN" || role === "HR",
  /**
   * The rep is the one standing in the clinic when the doctor pays, so they may
   * record a receipt — but only against an invoice raised in their own name,
   * and recording a receipt can never alter what was billed.
   */
  recordPayment: (role: Role) => role === "ADMIN" || usesFieldPanel(role),
  /** Receiving stock and correcting the warehouse count. */
  manageInventory: (role: Role) => role === "ADMIN",

  // ------------------------------------------------------------------ people
  /** The HR desk: employee records, attendance and leave. */
  viewHr: (role: Role) => role === "ADMIN" || role === "HR",
  /** Marking a day present or absent, and correcting one already marked. */
  manageAttendance: (role: Role) => role === "ADMIN" || role === "HR",
  /** Approving or refusing somebody's leave. Never their own — checked on the server. */
  manageLeave: (role: Role) => role === "ADMIN" || role === "HR",
  /** Everybody works, so everybody can ask for time off. */
  applyLeave: () => true
};
