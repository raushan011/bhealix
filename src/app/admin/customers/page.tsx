"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Pencil, Plus, Receipt, Search, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { CustomerForm } from "@/components/billing/customer-form";
import { can, type Role } from "@/constants/access";
import { CUSTOMER_TYPES } from "@/lib/billing/constants";
import { customerTitle, type CustomerRecord } from "@/lib/billing/customers";

/**
 * Everyone supplied who is not a doctor on the visiting list: stockists,
 * distributors, chemists, hospitals and private buyers. Kept apart from the
 * doctor directory because none of them have call times or sit on a route.
 */
export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [editing, setEditing] = useState<CustomerRecord | "new" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ all: "1", limit: "100" });
    if (query.trim()) params.set("q", query.trim());
    if (type) params.set("type", type);
    const response = await fetch(`/api/customers?${params}`);
    const json = await response.json() as { data?: { items: CustomerRecord[] } };
    setCustomers(json.data?.items ?? []);
    setLoading(false);
  }, [query, type]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json())
      .then((json: { data?: { role: Role } }) => setRole(json.data?.role ?? null));
  }, []);

  const mayManage = role !== null && can.manageBilling(role);

  async function remove(customer: CustomerRecord) {
    if (!window.confirm(`Remove ${customer.name} from the customer list?`)) return;
    const response = await fetch(`/api/customers/${customer._id}`, { method: "DELETE" });
    const json = await response.json() as { error?: string; data?: { deactivated?: boolean; billed?: number } };
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not remove this customer" }); return; }
    setNotice({
      tone: "success",
      text: json.data?.deactivated
        ? `${customer.name} has ${json.data.billed} bill(s) against them, so they were deactivated instead of deleted — the billing history stays intact.`
        : `${customer.name} removed.`
    });
    load();
  }

  return <div className="space-y-5">
    <PageTitle title="Customers" subtitle="Stockists, distributors, chemists, hospitals and individuals you supply"
      actions={mayManage && <Button onClick={() => setEditing("new")}><Plus size={16} />Add customer</Button>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <Card className="space-y-3 p-4">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" />
        <input value={query} onChange={e => setQuery(e.target.value)} className="input pl-9"
          placeholder="Search by name, city, GSTIN or phone" aria-label="Search customers" />
      </div>
      <select value={type} onChange={e => setType(e.target.value)} className="select" aria-label="Filter by type">
        <option value="">Every type</option>
        {CUSTOMER_TYPES.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </Card>

    {loading && <Spinner label="Loading customers…" />}

    {!loading && !customers.length && (
      <EmptyState icon={Building2} title={query || type ? "No customers match this" : "No customers yet"}
        description="Add the stockists, distributors and other buyers you supply. A bill can then be raised for them exactly as it is for a doctor."
        action={mayManage && <Button onClick={() => setEditing("new")}>Add customer</Button>} />
    )}

    {!loading && customers.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {customers.map(customer => (
          <div key={customer._id} className="flex items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{customerTitle(customer)}</p>
                <Badge tone="info">{customer.type}</Badge>
                {!customer.active && <Badge tone="warn">Inactive</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {[
                  customer.code, customer.city, customer.phones?.[0],
                  customer.gstin ? `GSTIN ${customer.gstin}` : "Unregistered",
                  customer.creditPeriod ? `${customer.creditPeriod} days credit` : null
                ].filter(Boolean).join(" · ")}
              </p>
            </div>

            <Link href={`/admin/billing?customer=${customer._id}`} aria-label={`Bills for ${customer.name}`}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
              <Receipt size={15} />
            </Link>
            {mayManage && <>
              <button onClick={() => setEditing(customer)} aria-label={`Edit ${customer.name}`}
                className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
                <Pencil size={15} />
              </button>
              <button onClick={() => remove(customer)} aria-label={`Remove ${customer.name}`}
                className="grid size-9 shrink-0 place-items-center rounded-lg text-rose-600 hover:bg-rose-50">
                <Trash2 size={15} />
              </button>
            </>}
          </div>
        ))}
      </Card>
    )}

    {editing && <CustomerForm customer={editing === "new" ? null : editing}
      onClose={() => setEditing(null)}
      onSaved={(_, text) => { setEditing(null); setNotice({ tone: "success", text }); load(); }} />}
  </div>;
}
