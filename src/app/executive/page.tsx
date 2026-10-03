import { requireExecutivePanel } from "@/lib/auth/guard";
import { ExecutiveToday } from "@/components/sales-team/executive-today";

/** The executive's day: deliveries to confirm, failed ones to reschedule, follow-ups due. */
export default async function ExecutiveDashboard() {
  const session = await requireExecutivePanel();
  return <ExecutiveToday name={session.name} />;
}
