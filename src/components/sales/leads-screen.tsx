"use client";

import { useState } from "react";
import { Search, UsersRound } from "lucide-react";
import { Notice, PageTitle } from "@/components/ui/kit";
import { LeadList } from "@/components/sales/lead-list";
import { LeadSearch } from "@/components/sales/lead-search";

/**
 * Prospecting, in the two halves it actually has: finding businesses, and then
 * ringing them.
 *
 * Tabs rather than one long page. The search half is transient — a form and
 * forty cards that are gone as soon as they are saved — and the saved half
 * grows to hundreds of rows that somebody scrolls for ten minutes at a time.
 * Stacked, the list would be permanently below the fold of a search nobody is
 * running.
 */
export function LeadsScreen({ maySearch }: { maySearch: boolean }) {
  const [tab, setTab] = useState<"search" | "saved">(maySearch ? "search" : "saved");
  /** Bumped when a search saves, so the list behind it is not stale on return. */
  const [savedAt, setSavedAt] = useState(0);

  const tabs = [
    ...(maySearch ? [["search", "Search", Search] as const] : []),
    ["saved", "Saved leads", UsersRound] as const
  ];

  return <div className="space-y-5">
    <PageTitle title="Leads"
      subtitle="Find businesses worth approaching, file them under a type, and work through the list" />

    {tabs.length > 1 && (
      <div className="flex gap-1.5 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-1">
        {tabs.map(([value, label, Icon]) => (
          <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value}
            className={`flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === value ? "bg-[var(--brand)] text-[var(--on-brand)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
            }`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>
    )}

    {!maySearch && (
      <Notice>
        Searching Google is billed against the company&rsquo;s quota, so it is the administrator&rsquo;s to run. The
        saved list below is yours to read and work through.
      </Notice>
    )}

    {tab === "search" && maySearch
      ? <LeadSearch onSaved={() => setSavedAt(current => current + 1)} />
      : <LeadList mayEdit={maySearch} reloadToken={savedAt} />}
  </div>;
}
