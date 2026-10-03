import { PageTitle } from "@/components/ui/kit";
import { FollowUpList } from "@/components/sales-team/follow-ups";

/** Everybody the executive promised to call back, with the day they promised. */
export default function ExecutiveFollowUpsPage() {
  return <div className="space-y-5">
    <PageTitle title="Follow-ups" subtitle="Who to call back, and when. Due ones also show on your Today screen." />
    <FollowUpList />
  </div>;
}
