import { connectDb } from "@/lib/db/mongoose";
import { Vault } from "@/components/finance/vault";
import { periodsWithDocuments } from "@/lib/finance/documents";
import { currentPeriod, recentPeriods } from "@/lib/finance/period";

export const dynamic = "force-dynamic";

/**
 * The months are resolved on the server so the picker is populated on the first
 * paint rather than after a round trip.
 *
 * Two sources for it, unioned: the months already filed into, and the two years
 * behind this one. The first is what somebody is coming back to; the second is
 * what lets them file a bill for a month nobody has touched yet — including,
 * every so often, one from last year that has just surfaced.
 */
export default async function InvoiceVaultPage() {
  await connectDb();
  const filed = await periodsWithDocuments(currentPeriod());
  const periods = [...new Set([...filed, ...recentPeriods(24)])].sort().reverse();

  return <Vault periods={periods} />;
}
