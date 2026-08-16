"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Plus, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate, todayIso } from "@/lib/time";
import { can, type Role } from "@/constants/access";

type Holiday = { _id: string; date: string; name: string; note?: string };

/**
 * The company calendar. A holiday applies to everybody, so it marks itself on
 * every employee's attendance sheet rather than being ticked person by person.
 */
export default function HolidaysPage() {
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [items, setItems] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [list, me] = await Promise.all([
      fetch(`/api/hr/holidays?year=${year}`).then(r => r.json()) as Promise<{ data?: { items: Holiday[] } }>,
      fetch("/api/auth/me").then(r => r.json()) as Promise<{ data?: { role: Role } }>
    ]);
    setItems(list.data?.items ?? []);
    setRole(me.data?.role ?? null);
    setLoading(false);
  }, [year]);
  useEffect(() => { load(); }, [load]);

  const mayManage = role !== null && can.manageAttendance(role);
  const today = todayIso();

  async function remove(holiday: Holiday) {
    if (!window.confirm(`Remove ${holiday.name} from the calendar?`)) return;
    const response = await fetch(`/api/hr/holidays?date=${holiday.date}`, { method: "DELETE" });
    if (!response.ok) { setNotice({ tone: "error", text: "Could not remove that holiday" }); return; }
    setNotice({ tone: "success", text: `${holiday.name} removed.` });
    load();
  }

  return <div className="space-y-5">
    <Link href="/admin/hr" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />People
    </Link>
    <PageTitle title="Holiday calendar" subtitle="Days nobody is expected to work"
      actions={mayManage && <Button onClick={() => setAdding(true)}><Plus size={16} />Add holiday</Button>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <Card className="p-4">
      <Field label="Year">
        <input type="number" min={2020} max={2100} value={year} onChange={e => setYear(e.target.value)} className="input" />
      </Field>
    </Card>

    {loading && <Spinner label="Loading the calendar…" />}

    {!loading && !items.length && (
      <EmptyState icon={CalendarDays} title={`No holidays set for ${year}`}
        description="Add your company holidays so they are excluded from everybody's working days."
        action={mayManage && <Button onClick={() => setAdding(true)}>Add holiday</Button>} />
    )}

    {!loading && items.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {items.map(holiday => (
          <div key={holiday._id} className="flex items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {holiday.name}
                {holiday.date < today && <span className="ml-2 text-xs font-normal text-[var(--muted)]">past</span>}
              </p>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {formatDate(holiday.date)}{holiday.note ? ` · ${holiday.note}` : ""}
              </p>
            </div>
            {mayManage && (
              <button onClick={() => remove(holiday)} aria-label={`Remove ${holiday.name}`}
                className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--danger-ink)] hover:bg-[var(--danger-bg)]"><Trash2 size={15} /></button>
            )}
          </div>
        ))}
      </Card>
    )}

    {adding && <AddHoliday onClose={() => setAdding(false)}
      onSaved={text => { setAdding(false); setNotice({ tone: "success", text }); load(); }} />}
  </div>;
}

function AddHoliday({ onClose, onSaved }: { onClose: () => void; onSaved: (text: string) => void }) {
  const [date, setDate] = useState(todayIso);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (name.trim().length < 2) { setError("Name the holiday"); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/hr/holidays", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, name: name.trim(), note: note.trim() || undefined })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not save that holiday");
      onSaved(`${name.trim()} added to the calendar.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save that holiday");
      setBusy(false);
    }
  }

  return <Modal title="Add a holiday" description="It applies to everybody and shows on every attendance sheet."
    onClose={onClose}
    footer={<Button className="w-full" busy={busy} onClick={submit}>{busy ? "Saving…" : "Add holiday"}</Button>}>
    <div className="space-y-4">
      <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" /></Field>
      <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Independence Day" /></Field>
      <Field label="Note (optional)"><input value={note} onChange={e => setNote(e.target.value)} className="input" /></Field>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
