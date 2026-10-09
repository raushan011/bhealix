"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Card, EmptyState, Field, Notice, Spinner } from "@/components/ui/kit";
import { formatRupees } from "@/lib/sales-team/orders";
import { call, messageOf } from "./shared";

type Cell = { orders: number; value: number; cancelled: number };
type Payload = {
  from: string; to: string;
  executives: Array<{ _id: string; name: string; employeeId?: string }>;
  days: Array<{ day: string; cells: Record<string, Cell>; total: Cell }>;
  totals: Record<string, Cell>;
  grand: Cell;
};

const indianDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const dayLabel = (day: string) => new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

const PRESETS: Array<{ label: string; range: () => [string, string] }> = [
  { label: "Today", range: () => [indianDay(), indianDay()] },
  { label: "Yesterday", range: () => [indianDay(-1), indianDay(-1)] },
  { label: "7 days", range: () => [indianDay(-6), indianDay()] },
  { label: "14 days", range: () => [indianDay(-13), indianDay()] },
  { label: "30 days", range: () => [indianDay(-29), indianDay()] },
  { label: "This month", range: () => [`${indianDay().slice(0, 8)}01`, indianDay()] }
];

/**
 * Orders placed day by day, and by whom: a row per day, a column per
 * executive, one for orders from the shop or Shiprocket, and the day's total.
 * Every figure opens the orders behind it.
 */
export function DailyOrders({ orderPath }: { orderPath: string }) {
  const [from, setFrom] = useState(indianDay(-13));
  const [to, setTo] = useState(indianDay());
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [hideQuiet, setHideQuiet] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await call<Payload>(`/api/sales-team/daily?${new URLSearchParams({ from, to })}`));
      setError("");
    } catch (problem) {
      setError(messageOf(problem));
    }
  }, [from, to]);
  useEffect(() => { const timer = setTimeout(load, 200); return () => clearTimeout(timer); }, [load]);

  const link = (day: { from: string; to: string }, who?: string) => {
    const query = new URLSearchParams({ from: day.from, to: day.to });
    if (who === "imported") query.set("source", "imported");
    else if (who) { query.set("executive", who); query.set("source", "CRM"); }
    return `${orderPath}?${query}`;
  };

  const figure = (cell: Cell | undefined, href: string, strong = false) => cell?.orders
    ? <Link href={href} className="group block rounded-[8px] px-2 py-1 hover:bg-[var(--brand-soft)]">
        <span className={`block tabular-nums ${strong ? "font-bold" : "font-semibold"} group-hover:text-[var(--brand)]`}>{cell.orders}</span>
        <span className="block text-[11px] tabular-nums text-[var(--muted)]">{formatRupees(Math.round(cell.value))}{cell.cancelled ? ` · ${cell.cancelled} cancelled` : ""}</span>
      </Link>
    : <span className="block px-2 py-1 text-[var(--muted)]">–</span>;

  const days = data ? (hideQuiet ? data.days.filter(row => row.total.orders) : data.days) : [];
  const range = data ? { from: data.from, to: data.to } : { from, to };

  return <div className="space-y-4">
    <Card className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Field label="From"><input type="date" className="input" value={from} max={to} onChange={event => setFrom(event.target.value)} /></Field>
        <Field label="To"><input type="date" className="input" value={to} min={from} max={indianDay()} onChange={event => setTo(event.target.value)} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {PRESETS.map(preset => (
          <button key={preset.label} type="button" onClick={() => { const [start, end] = preset.range(); setFrom(start); setTo(end); }}
            className="rounded-full border border-[var(--line-2)] px-3 py-1.5 font-semibold hover:bg-[var(--surface-2)]">{preset.label}</button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-[var(--muted)]">
          <input type="checkbox" checked={hideQuiet} onChange={event => setHideQuiet(event.target.checked)} />Hide days with no orders
        </label>
      </div>
    </Card>

    {error && <Notice tone="error">{error}</Notice>}
    {!data && !error && <Spinner label="Counting orders…" />}

    {data && <>
      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Figure label="Orders" value={String(data.grand.orders)} />
        <Figure label="Value" value={formatRupees(Math.round(data.grand.value))} />
        <Figure label="By executives" value={String(data.executives.reduce((sum, person) => sum + (data.totals[person._id]?.orders ?? 0), 0))} />
        <Figure label="From shop / Shiprocket" value={String(data.totals.imported?.orders ?? 0)} />
      </Card>

      {!days.length ? <EmptyState icon={CalendarDays} title="No orders in these days" description="Choose a wider range." /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-xs text-[var(--muted)]">
                <th className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-3 font-semibold">Date</th>
                {data.executives.map(person => <th key={person._id} className="px-2 py-3 font-semibold">{person.name}</th>)}
                <th className="px-2 py-3 font-semibold">Shop / Shiprocket</th>
                <th className="px-2 py-3 font-semibold text-[var(--ink)]">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {days.map(row => {
                const day = { from: row.day, to: row.day };
                return <tr key={row.day} className="align-top">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-[var(--surface)] px-4 py-2.5 font-medium">{dayLabel(row.day)}</td>
                  {data.executives.map(person => <td key={person._id} className="py-1">{figure(row.cells[person._id], link(day, person._id))}</td>)}
                  <td className="py-1">{figure(row.cells.imported, link(day, "imported"))}</td>
                  <td className="py-1">{figure(row.total, link(day), true)}</td>
                </tr>;
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--line-2)] align-top">
                <td className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-2.5 font-bold">All days</td>
                {data.executives.map(person => <td key={person._id} className="py-1">{figure(data.totals[person._id], link(range, person._id), true)}</td>)}
                <td className="py-1">{figure(data.totals.imported, link(range, "imported"), true)}</td>
                <td className="py-1">{figure(data.grand, link(range), true)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
      <p className="text-xs text-[var(--muted)]">Days are counted in India time. Value leaves out cancelled orders. Press any figure to see those orders.</p>
    </>}
  </div>;
}

function Figure({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="truncate text-xs text-[var(--muted)]">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p></div>;
}
