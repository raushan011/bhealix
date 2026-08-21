import { DemoLeads } from "@/components/control/demo-leads";

export const dynamic = "force-dynamic";

/** Guarded one level up: the control layout admits the super administrator alone. */
export default function DemoLeadsPage() {
  return <DemoLeads />;
}
