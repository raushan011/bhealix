import { requireExecutivePanel } from "@/lib/auth/guard";
import { ExecutiveShell } from "@/components/layout/executive-shell";

/**
 * The sales executive's panel. The middleware already keeps everybody else out;
 * this is the page-level guard that does not rest on it (§4.8).
 */
export default async function ExecutiveLayout({ children }: { children: React.ReactNode }) {
  const session = await requireExecutivePanel();
  return <ExecutiveShell user={{ name: session.name }}>{children}</ExecutiveShell>;
}
