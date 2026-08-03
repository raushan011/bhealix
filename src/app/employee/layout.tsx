import { FieldShell } from "@/components/layout/field-shell";
import { requireFieldPanel } from "@/lib/auth/guard";

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const session = await requireFieldPanel();
  return <FieldShell user={{ name: session.name, role: session.role }}>{children}</FieldShell>;
}
