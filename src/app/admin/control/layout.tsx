import { requireWorkspace } from "@/lib/auth/guard";

/**
 * The super admin panel's door.
 *
 * `requireWorkspace("control")` resolves to the role and to nothing else — the
 * panel that hands out grants is deliberately not itself grantable, so there is
 * no sequence of clicks on the access screen that ends with somebody letting
 * themselves in here.
 */
export default async function ControlLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspace("control");
  return <>{children}</>;
}
