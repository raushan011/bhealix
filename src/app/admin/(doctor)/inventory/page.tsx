"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Boxes, PackagePlus, Plus, ScrollText, SlidersHorizontal, Undo2, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate, todayIso } from "@/lib/time";
import { can, type Role } from "@/constants/access";
import { formatMoney } from "@/lib/billing/constants";
import { STOCK_LABEL, type ManualStockType, type StockMovementType } from "@/lib/inventory/movements";

type Level = {
  product: string; productId?: string; category?: string; unit?: string; hsnCode?: string;
  price: number; gstRate: number; reorderLevel: number;
  received: number; sold: number; sampled: number; returned: number; adjusted: number;
  balance: number; stockValue: number; alert: "out" | "low" | null;
};
type Totals = { products: number; inStock: number; low: number; out: number; units: number; value: number };
type Movement = {
  _id: string; type: StockMovementType; productName: string; quantity: number;
  batchNo?: string; supplier?: string; reference?: string; occurredAt: string; notes?: string;
  invoice?: { invoiceNo: string } | null;
  employee?: { name: string } | null;
  actor?: { name: string } | null;
};

const TABS = [
  { key: "levels", label: "Stock on hand", icon: Boxes },
  { key: "ledger", label: "Movement history", icon: ScrollText }
] as const;

const movementTone = (type: StockMovementType) =>
  type === "PURCHASE" || type === "OPENING" ? "info"
    : type === "SALE" ? "success"
    : type === "SAMPLE_ISSUE" ? "brand"
    : type === "ADJUSTMENT" ? "neutral" : "warn";

export default function InventoryPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("levels");
  const [levels, setLevels] = useState<Level[]>([]);
  const [totals, setTotals] = useState<Totals>({ products: 0, inStock: 0, low: 0, out: 0, units: 0, value: 0 });
  const [movements, setMovements] = useState<Movement[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState<ManualStockType | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [stock, ledger, me] = await Promise.all([
      fetch("/api/inventory/stock").then(r => r.json()) as Promise<{ data?: { rows: Level[]; totals: Totals } }>,
      fetch("/api/inventory/movements?limit=200").then(r => r.json()) as Promise<{ data?: { items: Movement[] } }>,
      fetch("/api/auth/me").then(r => r.json()) as Promise<{ data?: { role: Role } }>
    ]);
    setLevels(stock.data?.rows ?? []);
    setTotals(stock.data?.totals ?? { products: 0, inStock: 0, low: 0, out: 0, units: 0, value: 0 });
    setMovements(ledger.data?.items ?? []);
    setRole(me.data?.role ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // HR reads the position; only an administrator moves any stock.
  const mayMove = role !== null && can.manageInventory(role);
  const negatives = levels.filter(row => row.balance < 0);

  return <div className="space-y-5">
    <PageTitle title="Inventory" subtitle="What the company holds, and where every unit went"
      actions={mayMove && <>
        <Button tone="secondary" onClick={() => setRecording("ADJUSTMENT")}><SlidersHorizontal size={16} />Adjust</Button>
        <Button tone="secondary" onClick={() => setRecording("SALE_RETURN")}><Undo2 size={16} />Sales return</Button>
        <Button onClick={() => setRecording("PURCHASE")}><PackagePlus size={16} />Receive stock</Button>
      </>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {loading && <Spinner label="Loading inventory…" />}

    {!loading && <>
      <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
        <Stat label="Units in stock" value={totals.units} />
        <Stat label="Stock value" value={formatMoney(totals.value)} />
        <Stat label="Low on stock" value={totals.low} tone={totals.low ? "text-[var(--warn-ink)]" : undefined} />
        <Stat label="Out of stock" value={totals.out} tone={totals.out ? "text-[var(--danger-ink)]" : undefined} />
      </Card>

      {negatives.length > 0 && (
        <Notice tone="error">
          {negatives.map(row => row.product).join(", ")} {negatives.length === 1 ? "has" : "have"} gone below zero —
          more has been billed or issued than was ever received. Enter the opening stock or the missing purchase, or
          record an adjustment once you know which.
        </Notice>
      )}

      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-xs font-semibold ${
              tab === key ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]"
            }`}><Icon size={14} />{label}</button>
        ))}
      </div>

      {tab === "levels" && (levels.length ? (
        <Card className="divide-y divide-[var(--line)]">
          {levels.map(row => (
            <div key={row.product} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold">{row.product}</p>
                    {row.alert === "out" && <Badge tone="danger">Out of stock</Badge>}
                    {row.alert === "low" && <Badge tone="warn">Low</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                    {row.received} received · {row.sold} sold · {row.sampled} sampled
                    {row.returned ? ` · ${row.returned} returned` : ""}
                    {row.adjusted ? ` · ${row.adjusted > 0 ? "+" : ""}${row.adjusted} adjusted` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-sm font-semibold ${row.balance < 0 ? "text-[var(--danger-ink)]" : ""}`}>
                    {row.balance} <span className="font-normal text-[var(--muted)]">{row.unit ?? "in hand"}</span>
                  </p>
                  {row.price > 0 && <p className="text-xs text-[var(--muted)]">{formatMoney(row.stockValue)}</p>}
                </div>
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState icon={Boxes} title="Nothing in the catalogue yet"
          description="Add your products first, then record what you hold. Bills and sample issues then count down from it automatically."
          action={<Link href="/admin/products" className="text-sm font-semibold text-[var(--brand)]">Go to products</Link>} />
      ))}

      {tab === "ledger" && (movements.length ? (
        <Card className="divide-y divide-[var(--line)]">
          {movements.map(row => (
            <div key={row._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5">
              <Badge tone={movementTone(row.type)}>{STOCK_LABEL[row.type]}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {row.productName} × {Math.abs(row.quantity)}
                  {row.type === "ADJUSTMENT" && (
                    <span className="ml-1 font-normal text-[var(--muted)]">({row.quantity > 0 ? "added" : "removed"})</span>
                  )}
                </p>
                <p className="truncate text-xs text-[var(--muted)]">
                  {[
                    row.invoice?.invoiceNo, row.employee?.name, row.supplier,
                    row.batchNo && `batch ${row.batchNo}`, row.reference, row.notes
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
              <p className="shrink-0 text-xs text-[var(--muted)]">{formatDate(row.occurredAt)}</p>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState icon={ScrollText} title="Nothing recorded yet"
          description="Every receipt, sale, sample issue and correction appears here as an audit trail."
          action={mayMove && <Button onClick={() => setRecording("OPENING")}>Enter opening stock</Button>} />
      ))}
    </>}

    {recording && <RecordStock type={recording} products={levels}
      onClose={() => setRecording(null)}
      onSaved={text => { setRecording(null); setNotice({ tone: "success", text }); load(); }} />}
  </div>;
}

type Line = { product: string; quantity: number; unitCost: number; batchNo: string; expiryAt: string };

const COPY: Record<ManualStockType, { title: string; description: string; submit: string }> = {
  PURCHASE: {
    title: "Receive stock",
    description: "Goods arriving from a supplier or from manufacturing.",
    submit: "Receive stock"
  },
  OPENING: {
    title: "Enter opening stock",
    description: "What you already hold, as a starting point for the ledger.",
    submit: "Save opening stock"
  },
  SALE_RETURN: {
    title: "Record a sales return",
    description: "Goods coming back from a doctor. The bill itself is unchanged — cancel it separately if it should not stand.",
    submit: "Record return"
  },
  ADJUSTMENT: {
    title: "Correct a count",
    description: "For damage, expiry, loss or a stocktake. Use a negative number to take stock away.",
    submit: "Save adjustment"
  }
};

function RecordStock({ type, products, onClose, onSaved }: {
  type: ManualStockType;
  products: Array<{ product: string; balance: number }>;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const copy = COPY[type];
  const [occurredAt, setOccurredAt] = useState(todayIso());
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { product: products[0]?.product ?? "", quantity: 1, unitCost: 0, batchNo: "", expiryAt: "" }
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (index: number, patch: Partial<Line>) =>
    setLines(current => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const detailed = type === "PURCHASE" || type === "OPENING";

  async function submit() {
    const filled = lines.filter(line => line.product && line.quantity !== 0);
    if (!filled.length) { setError("Add at least one product"); return; }

    setBusy(true); setError("");
    try {
      const response = await fetch("/api/inventory/movements", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type, occurredAt,
          supplier: supplier.trim() || undefined,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
          lines: filled.map(line => ({
            product: line.product,
            quantity: line.quantity,
            unitCost: line.unitCost || undefined,
            batchNo: line.batchNo || undefined,
            expiryAt: line.expiryAt || undefined
          }))
        })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not save this");
      onSaved(`${copy.submit} — ${filled.length} product line${filled.length === 1 ? "" : "s"} recorded.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save this");
      setBusy(false);
    }
  }

  return <Modal title={copy.title} description={copy.description} onClose={onClose}
    footer={<Button onClick={submit} busy={busy} className="w-full">{busy ? "Saving…" : copy.submit}</Button>}>
    <div className="space-y-4">
      <Field label="Date">
        <input type="date" max={todayIso()} value={occurredAt} onChange={e => setOccurredAt(e.target.value)} className="input" />
      </Field>

      {detailed && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier"><input value={supplier} onChange={e => setSupplier(e.target.value)} className="input" /></Field>
        <Field label="Reference" hint="Supplier's invoice or challan number">
          <input value={reference} onChange={e => setReference(e.target.value)} className="input" />
        </Field>
      </div>}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-medium text-[var(--ink-2)]">Products</p>
          <button type="button"
            onClick={() => setLines(current => [...current, { product: products[0]?.product ?? "", quantity: 1, unitCost: 0, batchNo: "", expiryAt: "" }])}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]"><Plus size={13} />Add line</button>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => (
            <div key={index} className="rounded-[10px] border border-[var(--line)] p-3">
              <div className="flex items-center gap-2">
                <select value={line.product} onChange={e => update(index, { product: e.target.value })}
                  aria-label="Product" className="select flex-1">
                  {products.length
                    ? products.map(product => <option key={product.product}>{product.product}</option>)
                    : <option value="">No products configured</option>}
                </select>
                <input type="number" value={line.quantity} min={type === "ADJUSTMENT" ? undefined : 1}
                  onChange={e => update(index, { quantity: Math.trunc(Number(e.target.value)) || 0 })}
                  aria-label="Quantity" className="input w-20 shrink-0" />
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines(current => current.filter((_, i) => i !== index))}
                    aria-label="Remove line" className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--danger-ink)]">
                    <X size={16} />
                  </button>
                )}
              </div>

              {detailed && (
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <input type="number" min={0} step="0.01" value={line.unitCost || ""}
                    onChange={e => update(index, { unitCost: Number(e.target.value) || 0 })}
                    placeholder="Cost per unit" aria-label="Cost per unit" className="input" />
                  <input value={line.batchNo} onChange={e => update(index, { batchNo: e.target.value })}
                    placeholder="Batch number" aria-label="Batch number" className="input" />
                  <input type="date" value={line.expiryAt} onChange={e => update(index, { expiryAt: e.target.value })}
                    aria-label="Expiry date" className="input" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <Field label="Notes (optional)">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} className="textarea" placeholder="Reason, reference…" />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
