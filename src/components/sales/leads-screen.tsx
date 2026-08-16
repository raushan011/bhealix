"use client";

import { useState } from "react";
import { MessageSquare, Search, Send, UsersRound } from "lucide-react";
import { Notice, PageTitle } from "@/components/ui/kit";
import { LeadList } from "@/components/sales/lead-list";
import { LeadSearch } from "@/components/sales/lead-search";
import { OutreachQueue } from "@/components/sales/outreach-queue";
import { RemarksLog } from "@/components/sales/remarks-log";

/**
 * Prospecting, in the halves it actually has: finding businesses, working out
 * which are worth approaching, approaching them, and reading back what came of
 * it.
 *
 * Tabs rather than one long page. The search half is transient — a form and
 * forty cards that are gone as soon as they are saved — and the saved half
 * grows to hundreds of rows that somebody scrolls for ten minutes at a time.
 * Stacked, the list would be permanently below the fold of a search nobody is
 * running.
 *
 * Outreach earns its own tab for a different reason: it is the one screen here
 * used on a phone rather than at a desk, standing up, one lead at a time. It
 * shares nothing with the list except the rows underneath.
 *
 * Remarks is the only tab that reads *across* leads. It is offered to everybody
 * who can see the list, including the desk that cannot run a search — "what
 * came of last week's calling" is a question asked far more often by the people
 * not making the calls.
 */
export function LeadsScreen({ maySearch }: { maySearch: boolean }) {
  const [tab, setTab] = useState<"search" | "saved" | "remarks" | "outreach">(maySearch ? "search" : "saved");
  /** Bumped when a search saves, so the list behind it is not stale on return. */
  const [savedAt, setSavedAt] = useState(0);

  const tabs = [
    ...(maySearch ? [["search", "Search", Search] as const] : []),
    ["saved", "Saved", UsersRound] as const,
    ["remarks", "Remarks", MessageSquare] as const,
    ...(maySearch ? [["outreach", "Send", Send] as const] : [])
  ];

  return <div className="space-y-5">
    <PageTitle title="Leads"
      subtitle="Find businesses worth approaching, file them under a type, and work through the list" />

    {tabs.length > 1 && (
      <div className="flex gap-1.5 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-1">
        {/*
          * `min-w-0` and a truncating label: four tabs on a 430px phone give
          * each about ninety pixels, and a flex item defaults to refusing to be
          * narrower than its content — which pushes the whole bar past the edge
          * of the screen rather than tightening the labels inside it.
          */}
        {tabs.map(([value, label, Icon]) => (
          <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value}
            className={`flex min-h-[40px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1 text-[13px] font-semibold transition-colors sm:gap-2 sm:text-sm ${
              tab === value ? "bg-[var(--brand)] text-[var(--on-brand)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
            }`}>
            <Icon size={15} className="shrink-0" /><span className="truncate">{label}</span>
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

    {tab === "search" && maySearch && <LeadSearch onSaved={() => setSavedAt(current => current + 1)} />}
    {tab === "outreach" && maySearch && <OutreachQueue mayEdit={maySearch} />}
    {tab === "remarks" && <RemarksLog mayEdit={maySearch} />}
    {tab === "saved" && <LeadList mayEdit={maySearch} reloadToken={savedAt} />}
  </div>;
}
