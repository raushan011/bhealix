import { redirect } from "next/navigation";
import { hasPermission, type Permission, type Role } from "@/constants/access";
import { getSession } from "./session";
export async function requireAuth() { const session=await getSession(); if(!session) redirect("/login"); return session; }
export async function requireRole(...roles: Role[]) { const s=await requireAuth(); if(!roles.includes(s.role)) redirect("/unauthorized"); return s; }
export async function requirePermission(permission: Permission) { const s=await requireAuth(); if(!hasPermission(s.role,permission,s.permissions)) redirect("/unauthorized"); return s; }
