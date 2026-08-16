"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Receipt, Search, Settings2 } from "lucide-react";
import { Card, EmptyState, LinkButton, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { InvoiceRow, invoiceLabel } from "@/components/billing/invoice-row";
import { can, type Role } from "@/constants/access";
import { formatMoney, INVOICE_STATUSES, PARTY_TYPES } from "@/lib/billing/constants";
import type { BillingSummary, InvoiceListRow } from "@/lib/billing/types";

type Person = { _id: string; name: string; employeeId: string };

export default function BillingPage() {
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const [summary, setSummary] = useState<BillingSummary>({ billed: 0, collected: 0, outstanding: 0 });
  const [people, setPeople] = useState<Person[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [employee, setEmployee] = useState("");
  const [partyType, setPartyType] = useState("");
  const [overdue, setOverdue] = useState(false);
  /**
   * Set when arriving from a customer's row in the directory. Read off
   * `location` rather than `useSearchParams` so this page never picks up a
   * Suspense requirement for one optional filter.
   */
  const [customer, setCustomer] = useState("");
  useEffect(() => { setCustomer(new URLSearchParams(window.location.search).get("customer") ?? ""); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (query.trim()) params.set("q", query.trim());
    if (status) params.set("status", status);
    if (employee) params.set("employee", employee);
    if (partyType) params.set("partyType", partyType);
    if (customer) params.set("customer", customer);
    if (overdue) params.set("overdue", "1");

    const response = await fetch(`/api/invoices?${params}`);
    const json = await response.json() as { data?: { items: InvoiceListRow[]; summary: BillingSummary } };
    setRows(json.data?.items ?? []);
    setSummary(json.data?.summary ?? { billed: 0, collected: 0, outstanding: 0 });
    setLoading(false);
  }, [query, status, employee, partyType, customer, overdue]);

  // Debounced, so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    Promise.all([
      fetch("/api/team?field=1").then(r => r.json()) as Promise<{ data?: { items: Person[] } }>,
      fetch("/api/auth/me").then(r => r.json()) as Promise<{ data?: { role: Role } }>
    ]).then(([staff, me]) => { setPeople(staff.data?.items ?? []); setRole(me.data?.role ?? null); });
  }, []);

  // HR reads the collection position; only an administrator raises a bill.
  const mayBill = role !== null && can.manageBilling(role);
  const overdueCount = rows.filter(row => invoiceLabel(row) === "Overdue").length;

  return <div className="space-y-5">
    <PageTitle title="Billing" subtitle="Bills raised against doctors, stockists and anyone else you supply"
      actions={mayBill && <>
        <LinkButton tone="secondary" href="/admin/billing/settings"><Settings2 size={16} />Settings</LinkButton>
        <LinkButton href="/admin/billing/new"><Plus size={16} />New bill</LinkButton>
      </>} />

    {/* Four across only once there is room for a twelve-character rupee total
        in each column, which a tablet does not have. */}
    <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
      <Stat label="Billed" value={formatMoney(summary.billed)} />
      <Stat label="Collected" value={formatMoney(summary.collected)} tone="text-[var(--ok-ink)]" />
      <Stat label="Outstanding" value={formatMoney(summary.outstanding)} tone={summary.outstanding > 0 ? "text-[var(--warn-ink)]" : undefined} />
      <Stat label="Bills shown" value={rows.length} />
    </Card>

    {overdueCount > 0 && !overdue && (
      <Notice tone="error">
        {overdueCount} bill{overdueCount === 1 ? " is" : "s are"} past their payment date.{" "}
        <button onClick={() => setOverdue(true)} className="font-semibold underline underline-offset-2">Show only those</button>.
      </Notice>
    )}

    <Card className="space-y-3 p-4">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" />
        <input value={query} onChange={e => setQuery(e.target.value)} className="input pl-9"
          placeholder="Search by bill number, doctor or clinic" aria-label="Search bills" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select value={status} onChange={e => setStatus(e.target.value)} className="select" aria-label="Filter by status">
          <option value="">Every status</option>
          {INVOICE_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select value={partyType} onChange={e => setPartyType(e.target.value)} className="select" aria-label="Filter by who was billed">
          <option value="">Every kind of buyer</option>
          {PARTY_TYPES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select value={employee} onChange={e => setEmployee(e.target.value)} className="select" aria-label="Filter by representative">
          <option value="">Every representative</option>
          {people.map(person => <option key={person._id} value={person._id}>{person.name} ({person.employeeId})</option>)}
        </select>
        <label className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-3 text-sm">
          <input type="checkbox" checked={overdue} onChange={e => setOverdue(e.target.checked)} className="size-4" />
          Overdue only
        </label>
      </div>

      {customer && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          Showing one customer&apos;s bills.
          <button onClick={() => setCustomer("")} className="font-semibold text-[var(--brand)] underline underline-offset-2">
            Show everybody
          </button>
        </p>
      )}
    </Card>

    {loading && <Spinner label="Loading bills…" />}

    {!loading && !rows.length && (
      <EmptyState icon={Receipt} title={query || status || employee || overdue ? "No bills match this" : "No bills yet"}
        description="Raise a bill for the products a doctor, stockist, distributor or individual has taken. It records which representative it belongs to, the discount on each line, the GST, and when the money is due."
        action={mayBill && <LinkButton href="/admin/billing/new">Raise a bill</LinkButton>} />
    )}

    {!loading && rows.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {rows.map(row => <InvoiceRow key={row._id} row={row} href={`/admin/billing/${row._id}`} />)}
      </Card>
    )}
  </div>;
}
