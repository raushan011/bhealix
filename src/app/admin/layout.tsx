import { AdminShell } from "@/components/layout/admin-shell";
import { requireAdminPanel } from "@/lib/auth/guard";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminPanel();
  return <AdminShell user={{ name: session.name, role: session.role }}>{children}</AdminShell>;
}
