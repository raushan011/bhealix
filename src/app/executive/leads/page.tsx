import { PageTitle } from "@/components/ui/kit";
import { LeadDesk } from "@/components/sales-team/lead-desk";

/** The leads handed to this executive, to ring and convert. */
export default function ExecutiveLeadsPage() {
  return <div className="space-y-5">
    <PageTitle title="My leads" subtitle="Ring them, note how it went, and place the order when they say yes" />
    <LeadDesk orderPath="/executive/orders" />
  </div>;
}
