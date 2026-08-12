import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { LeadsScreen } from "@/components/sales/leads-screen";

/**
 * A server component only to learn who is asking.
 *
 * Searching spends the company's Google quota and saving writes rows, so both
 * are `manageSales`; reading the list is `viewSales`. The API routes enforce
 * that themselves (§4.8) — this is what stops HR being shown a Search tab that
 * would answer 403, which is a worse screen than not offering it at all.
 */
export default async function SalesLeadsPage() {
  const session = await requireAdminPanel();
  return <LeadsScreen maySearch={can.manageSales(session.role)} />;
}
