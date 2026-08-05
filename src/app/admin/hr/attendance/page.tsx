"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate, todayIso } from "@/lib/time";
import { can, type Role } from "@/constants/access";
import {
  ATTENDANCE_INITIAL, ATTENDANCE_STATUSES, ATTENDANCE_TONE, monthKey, parseMonth,
  type AttendanceStatus, type AttendanceSummary
} from "@/lib/hr/attendance";

type Day = { date: string; status: AttendanceStatus | null; source: string | null; note?: string };
type Row = {
  employee: string; name: string; employeeId: string; role: Role;
  days: Day[]; summary: AttendanceSummary;
};

const cellTone: Record<AttendanceStatus, string> = {
  "Present": "bg-emerald-100 text-emerald-800",
  "Absent": "bg-rose-100 text-rose-700",
  "Half day": "bg-amber-100 text-amber-900",
  "On leave": "bg-sky-100 text-sky-800",
  "Week off": "bg-[var(--surface-2)] text-[var(--muted)]",
  "Holiday": "bg-[var(--brand-soft)] text-[var(--ink-2)]"
};

const shiftMonth = (month: string, by: number) => {
  const parsed = parseMonth(month);
  if (!parsed) return month;
  const date = new Date(parsed.year, parsed.month - 1 + by, 1);
  return monthKey(date.getFullYear(), date.getMonth() + 1);
};

/**
 * The month at a glance: one row per person, one cell per day.
 *
 * Most cells fill themselves in — a completed visit means the rep was out, and
 * approved leave marks itself — so what is left to do by hand is the exceptions.
 * An empty cell means nobody has said yet, which is deliberately different from
 * an absence.
 */
export default function AttendancePage() {
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [marking, setMarking] = useState<{ row: Row; day: Day } | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Arriving from the dashboard with a month already chosen.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("month");
    if (wanted && parseMonth(wanted)) setMonth(wanted);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [sheet, me] = await Promise.all([
      fetch(`/api/hr/attendance?month=${month}`).then(r => r.json()) as Promise<{ data?: { rows: Row[] } }>,
      fetch("/api/auth/me").then(r => r.json()) as Promise<{ data?: { role: Role } }>
    ]);
    setRows(sheet.data?.rows ?? []);
    setRole(me.data?.role ?? null);
    setLoading(false);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const mayMark = role !== null && can.manageAttendance(role);
  const parsed = parseMonth(month);
  const label = parsed ? new Date(parsed.year, parsed.month - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : month;

  async function mark(row: Row, date: string, status: AttendanceStatus | null, note?: string) {
    const response = status === null
      ? await fetch(`/api/hr/attendance?employee=${row.employee}&date=${date}`, { method: "DELETE" })
      : await fetch("/api/hr/attendance", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ employee: row.employee, date, status, note })
        });
    const json = await response.json() as { error?: string };
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not save that" }); return; }
    setNotice({
      tone: "success",
      text: status === null
        ? `Mark cleared for ${row.name} on ${formatDate(date)}.`
        : `${row.name} marked ${status.toLowerCase()} on ${formatDate(date)}.`
    });
    setMarking(null);
    load();
  }

  return <div className="space-y-5">
    <Link href="/admin/hr" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />People
    </Link>
    <PageTitle title="Attendance" subtitle="Days fill in from completed visits and approved leave — mark only the exceptions" />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-2">
        <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"
          className="tap grid place-items-center rounded-[10px] border border-[var(--line-2)] bg-white"><ChevronLeft size={16} /></button>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} aria-label="Month" className="input !min-h-[40px] w-auto" />
        <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"
          className="tap grid place-items-center rounded-[10px] border border-[var(--line-2)] bg-white"><ChevronRight size={16} /></button>
      </div>
      <p className="text-sm font-semibold">{label}</p>
    </Card>

    <div className="flex flex-wrap gap-2 text-xs">
      {ATTENDANCE_STATUSES.map(status => (
        <span key={status} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${cellTone[status]}`}>
          <span className="font-bold">{ATTENDANCE_INITIAL[status]}</span>{status}
        </span>
      ))}
    </div>

    {loading && <Spinner label="Loading attendance…" />}

    {!loading && !rows.length && (
      <EmptyState icon={CalendarCheck} title="Nobody to show"
        description="Add employees first — their attendance then builds itself from the work they record." />
    )}

    {!loading && rows.length > 0 && (
      <Card className="overflow-hidden">
        {/* The grid scrolls sideways rather than squeezing 31 days onto a phone. */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[var(--surface-2)]">
                <th className="sticky left-0 z-10 min-w-[150px] bg-[var(--surface-2)] px-3 py-2 text-left font-semibold">Employee</th>
                {rows[0].days.map(day => (
                  <th key={day.date} className="w-8 px-0 py-2 text-center font-semibold text-[var(--muted)]">
                    {Number(day.date.slice(8))}
                  </th>
                ))}
                <th className="min-w-[76px] px-3 py-2 text-right font-semibold">Worked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.employee} className="border-t border-[var(--line)]">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2">
                    <Link href={`/admin/team/${row.employee}`} className="block min-w-0">
                      <span className="block truncate font-semibold">{row.name}</span>
                      <span className="block truncate text-[11px] text-[var(--muted)]">{row.employeeId}</span>
                    </Link>
                  </td>
                  {row.days.map(day => (
                    <td key={day.date} className="p-0.5 text-center">
                      <button
                        onClick={() => mayMark && setMarking({ row, day })}
                        disabled={!mayMark}
                        title={`${formatDate(day.date)} — ${day.status ?? "not marked"}${day.note ? ` (${day.note})` : ""}`}
                        aria-label={`${row.name} on ${day.date}: ${day.status ?? "not marked"}`}
                        className={`grid size-7 w-full place-items-center rounded font-bold disabled:cursor-default ${
                          day.status ? cellTone[day.status] : "bg-white text-[var(--line-2)]"
                        } ${mayMark ? "hover:ring-2 hover:ring-[var(--brand)]" : ""}`}>
                        {day.status ? ATTENDANCE_INITIAL[day.status] : "·"}
                      </button>
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <span className="font-semibold">{row.summary.worked}</span>
                    <span className="text-[var(--muted)]">/{row.summary.expected}</span>
                    <span className="block text-[11px] text-[var(--muted)]">{row.summary.percent}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    )}

    {marking && <MarkDay row={marking.row} day={marking.day}
      onClose={() => setMarking(null)}
      onSave={(status, note) => mark(marking.row, marking.day.date, status, note)} />}
  </div>;
}

function MarkDay({ row, day, onClose, onSave }: {
  row: Row; day: Day; onClose: () => void;
  onSave: (status: AttendanceStatus | null, note?: string) => void;
}) {
  const [status, setStatus] = useState<AttendanceStatus>(day.status ?? "Present");
  const [note, setNote] = useState(day.source === "Manual" ? day.note ?? "" : "");

  return <Modal title={formatDate(day.date)} description={`${row.name} · ${row.employeeId}`} onClose={onClose}
    footer={<div className="flex gap-2">
      {day.source === "Manual" && (
        <Button tone="secondary" className="flex-1" onClick={() => onSave(null)}>Clear the mark</Button>
      )}
      <Button className="flex-1" onClick={() => onSave(status, note.trim() || undefined)}>Save</Button>
    </div>}>
    <div className="space-y-4">
      {day.status && day.source !== "Manual" && (
        <Notice tone="info">
          This day currently reads <strong>{day.status}</strong> on its own{day.note ? ` — ${day.note}` : ""}. Marking it
          by hand overrides that.
        </Notice>
      )}

      <Field label="Mark the day as">
        <div className="grid grid-cols-2 gap-2">
          {ATTENDANCE_STATUSES.map(value => (
            <button key={value} type="button" onClick={() => setStatus(value)}
              className={`rounded-[10px] border px-3 py-2.5 text-left text-sm font-semibold ${
                status === value ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line-2)] bg-white"
              }`}>
              <Badge tone={ATTENDANCE_TONE[value]}>{ATTENDANCE_INITIAL[value]}</Badge>
              <span className="mt-1 block">{value}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Note (optional)" hint="Why the day reads this way">
        <input value={note} onChange={e => setNote(e.target.value)} className="input" placeholder="Office day, training, unwell…" />
      </Field>
    </div>
  </Modal>;
}
