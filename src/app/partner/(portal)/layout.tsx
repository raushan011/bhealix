import { PartnerShell } from "@/components/layout/partner-shell";
import { requirePartner } from "@/lib/auth/partner";

/**
 * The signed-in half of the affiliate portal.
 *
 * A route group rather than a folder, so `/partner/login` and
 * `/partner/register` sit outside it. Guarding all of `/partner` from one layout
 * would have put the login page behind a guard whose only response to a signed
 * out visitor is to redirect them to the login page — a loop that only shows up
 * once somebody's session expires.
 *
 * `requirePartner` reloads the rep on every request rather than trusting the
 * cookie's claim, so an account suspended a minute ago is out on the next
 * navigation.
 */
export default async function PartnerPortalLayout({ children }: { children: React.ReactNode }) {
  const { rep, session } = await requirePartner();
  return <PartnerShell rep={{ name: rep.name ?? session.name, code: rep.code ?? session.code }}>{children}</PartnerShell>;
}
