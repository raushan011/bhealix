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
  planRoutes: (role: Role) => role === "ADMIN",
  viewAllReports: (role: Role) => role === "ADMIN",
  logVisits: (role: Role) => usesFieldPanel(role),
  /** Field staff learn the real call timing from the doctor, so they may correct it. */
  updateCallTime: (role: Role) => role === "ADMIN" || usesFieldPanel(role)
};
