"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

/**
 * Removes a route plan. Completed visits are history and are kept by the
 * server; only visits still waiting to happen go with the plan.
 */
export function DeletePlanButton({ planId, planName, redirectTo }: {
  planId: string;
  planName: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(`Delete "${planName}"? Visits already completed are kept; the ones still planned are removed.`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/plans/${planId}`, { method: "DELETE" });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not delete this plan");
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (problem) {
      window.alert(problem instanceof Error ? problem.message : "Could not delete this plan");
    } finally {
      setBusy(false);
    }
  }

  return <button onClick={remove} disabled={busy} aria-label={`Delete ${planName}`}
    className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--danger-ink)] hover:bg-[var(--danger-bg)] disabled:opacity-50">
    {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
  </button>;
}
