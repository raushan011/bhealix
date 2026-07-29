export const ROLES = ["ADMIN", "MR", "HR", "SALES"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "employee:read", "employee:write", "doctor:read:all", "doctor:read:assigned", "doctor:write",
  "assignment:manage", "visit:manage:own", "order:manage:own", "report:read:all", "audit:read",
  "confidential-note:read"
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  MR: ["doctor:read:assigned", "visit:manage:own", "order:manage:own"],
  HR: ["employee:read", "employee:write"],
  SALES: ["doctor:read:assigned", "visit:manage:own", "order:manage:own"]
};

export function hasPermission(role: Role, permission: Permission, grants: readonly Permission[] = []) {
  return ROLE_PERMISSIONS[role].includes(permission) || grants.includes(permission);
}
