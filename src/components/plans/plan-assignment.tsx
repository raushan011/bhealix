"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCheck } from "lucide-react";
import { Button, Card, Notice } from "@/components/ui/kit";

type Person = { _id: string; name: string; employeeId: string; role: string };

export function PlanAssignment({ planId, currentAssignee, team }: {
  planId: string;
  currentAssignee: { _id: string; name: string } | null;
  team: Person[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentAssignee?._id ?? "");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function assign() {
    if (!selected) return;
    setSaving(true); setResult(null);
    try {
      const response = await fetch(`/api/plans/${planId}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignedTo: selected })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not assign this plan");
      const person = team.find(member => member._id === selected);
      setResult({ tone: "success", text: `Assigned to ${person?.name ?? "the selected employee"}. It is on their phone now, under Plans.` });
      router.refresh();
    } catch (problem) {
      setResult({ tone: "error", text: problem instanceof Error ? problem.message : "Could not assign this plan" });
    } finally { setSaving(false); }
  }

  const changed = selected !== (currentAssignee?._id ?? "");
  const label = !changed && currentAssignee ? "Resend" : currentAssignee ? "Reassign" : "Assign";

  return <Card className="p-5">
    <div className="flex items-center gap-2">
      <UserCheck size={17} className="text-[var(--brand)]" />
      <h2 className="text-[15px] font-semibold">Assignment</h2>
    </div>
    <p className="mt-1 text-sm text-[var(--muted)]">
      {currentAssignee ? `Currently with ${currentAssignee.name}.` : "Not assigned yet."} Assigning creates each stop as a visit for that
      person, and the plan appears on their phone straight away. Resend if their day ever looks empty.
    </p>

    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
      <select value={selected} onChange={e => setSelected(e.target.value)} className="select sm:flex-1">
        <option value="">Choose an employee…</option>
        {team.map(person => <option key={person._id} value={person._id}>{person.name} ({person.employeeId}) · {person.role}</option>)}
      </select>
      <Button onClick={assign} busy={saving} disabled={!selected}>{label}</Button>
    </div>

    {result && <div className="mt-3"><Notice tone={result.tone}>{result.text}</Notice></div>}
  </Card>;
}
