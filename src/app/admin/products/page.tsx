"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatMoney, GST_RATES, UNITS } from "@/lib/billing/constants";
import { stockAlert } from "@/lib/inventory/movements";

type Product = {
  _id: string; name: string; category?: string; sampleAvailable: boolean; active: boolean;
  hsnCode?: string; unit?: string; price?: number; mrp?: number; gstRate?: number; reorderLevel?: number;
  /** Units available: one pool, drawn down by both sample issues and bills. */
  stock?: number;
};

const alertFor = (product: Product) => stockAlert(product.stock ?? 0, product.reorderLevel ?? 0);

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/products?all=1");
    const json = await response.json() as { data?: { items: Product[] } };
    setProducts(json.data?.items ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function remove(product: Product) {
    if (!window.confirm(`Remove ${product.name} from the catalogue?`)) return;
    const response = await fetch(`/api/products/${product._id}`, { method: "DELETE" });
    const json = await response.json() as { error?: string; data?: { retired?: boolean; usedIn?: number } };
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not remove this product" }); return; }
    setNotice({
      tone: "success",
      text: json.data?.retired
        ? `${product.name} appears in ${json.data.usedIn} record(s) — visits, stock or bills — so it was retired instead of deleted. The history stays intact.`
        : `${product.name} removed.`
    });
    load();
  }

  async function toggleActive(product: Product) {
    await fetch(`/api/products/${product._id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !product.active })
    });
    load();
  }

  const live = products.filter(product => product.active);
  const unpriced = live.filter(product => !product.price).length;
  const shortages = live.filter(product => alertFor(product));
  const unitsHeld = live.reduce((total, product) => total + (product.stock ?? 0), 0);

  return <div className="space-y-5">
    <PageTitle title="Products"
      subtitle="What your representatives discuss, hand out as samples, and bill — all from one stock of units"
      actions={<Button onClick={() => setEditing("new")}><Plus size={16} />Add product</Button>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {!loading && products.length > 0 && (
      <Card className="grid grid-cols-3 gap-5 p-5">
        <Stat label="Products on offer" value={live.length} />
        <Stat label="Units available" value={unitsHeld} />
        <Stat label="Need restocking" value={shortages.length} tone={shortages.length ? "text-amber-700" : undefined} />
      </Card>
    )}

    {!loading && shortages.length > 0 && (
      <Notice tone="error">
        {shortages.map(product => product.name).join(", ")} {shortages.length === 1 ? "is" : "are"} out of stock or
        below the reorder level. Samples and bills draw on the same units, so both stop being possible once this reaches zero.
      </Notice>
    )}

    {!loading && unpriced > 0 && (
      <Notice tone="info">
        {unpriced} product{unpriced === 1 ? " has" : "s have"} no selling rate. A rate, an HSN code and a GST slab here
        mean a bill is raised by choosing a product and typing a quantity.
      </Notice>
    )}

    {loading && <Spinner label="Loading products…" />}

    {!loading && !products.length && (
      <EmptyState icon={Package} title="No products yet"
        description="Add your real BHEALIX range. These are the options a rep picks from when logging what was discussed, and the lines an administrator bills."
        action={<Button onClick={() => setEditing("new")}>Add product</Button>} />
    )}

    {!loading && products.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {products.map(product => (
          <div key={product._id} className="flex items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{product.name}</p>
                {!product.active && <Badge tone="warn">Retired</Badge>}
                {product.active && !product.price && <Badge tone="neutral">No rate</Badge>}
                {product.active && alertFor(product) === "out" && <Badge tone="danger">Out of stock</Badge>}
                {product.active && alertFor(product) === "low" && <Badge tone="warn">Low stock</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {[
                  product.category,
                  product.price ? `${formatMoney(product.price)} per ${product.unit ?? "unit"}` : null,
                  product.gstRate !== undefined ? `GST ${product.gstRate}%` : null,
                  product.hsnCode ? `HSN ${product.hsnCode}` : null,
                  product.reorderLevel ? `reorder at ${product.reorderLevel}` : null
                ].filter(Boolean).join(" · ") || "No commercial details yet"}
              </p>
            </div>

            {/* The one pool: what is left after samples and bills have taken theirs. */}
            <div className="shrink-0 text-right">
              <p className={`text-sm font-semibold ${(product.stock ?? 0) < 0 ? "text-rose-700" : ""}`}>
                {product.stock ?? 0}
              </p>
              <p className="text-[11px] text-[var(--muted)]">available</p>
            </div>
            <button onClick={() => setEditing(product)} aria-label={`Edit ${product.name}`}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--ink-2)] hover:bg-[var(--surface-2)]"><Pencil size={15} /></button>
            <Button tone="secondary" className="!min-h-[38px] !px-3 text-xs" onClick={() => toggleActive(product)}>
              {product.active ? "Retire" : "Restore"}
            </Button>
            <button onClick={() => remove(product)} aria-label={`Remove ${product.name}`}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-rose-600 hover:bg-rose-50"><Trash2 size={15} /></button>
          </div>
        ))}
      </Card>
    )}

    {editing && <ProductForm product={editing === "new" ? null : editing}
      onClose={() => setEditing(null)}
      onSaved={text => { setEditing(null); setNotice({ tone: "success", text }); load(); }} />}
  </div>;
}

/**
 * One form for adding and for editing. The commercial fields are optional — a
 * product can exist purely to be discussed on a visit — but they are what a
 * bill reads, so they sit alongside the name rather than behind another screen.
 */
function ProductForm({ product, onClose, onSaved }: {
  product: Product | null; onClose: () => void; onSaved: (text: string) => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [hsnCode, setHsnCode] = useState(product?.hsnCode ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "Pcs");
  const [price, setPrice] = useState(product?.price ?? 0);
  const [mrp, setMrp] = useState(product?.mrp ?? 0);
  const [gstRate, setGstRate] = useState(product?.gstRate ?? 18);
  const [reorderLevel, setReorderLevel] = useState(product?.reorderLevel ?? 0);
  const [stock, setStock] = useState(product?.stock ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const held = product?.stock ?? 0;
  const movement = stock - held;

  async function submit() {
    if (name.trim().length < 2) { setError("Enter the product name"); return; }
    setBusy(true); setError("");
    try {
      const body = {
        name: name.trim(),
        category: category.trim() || undefined,
        hsnCode: hsnCode.trim() || undefined,
        unit, price, mrp, gstRate, reorderLevel,
        // Only sent when it has actually moved, so opening a product and
        // saving an unrelated change writes no stock row.
        ...(movement !== 0 ? { stock } : {})
      };
      const response = await fetch(product ? `/api/products/${product._id}` : "/api/products", {
        method: product ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not save this product");
      onSaved(product ? `${body.name} updated.` : `${body.name} added.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save this product");
      setBusy(false);
    }
  }

  return <Modal title={product ? "Edit product" : "Add product"}
    description="Use the exact name your team will recognise — it is the name that appears on visits, stock and bills."
    onClose={onClose}
    footer={<Button onClick={submit} busy={busy} className="w-full">{busy ? "Saving…" : product ? "Save changes" : "Add product"}</Button>}>
    <div className="space-y-4">
      <Field label="Product name">
        <input value={name} onChange={e => setName(e.target.value)} minLength={2} className="input" />
      </Field>
      <Field label="Category" hint="Optional — for example Cleanser, Serum, Sun care">
        <input value={category} onChange={e => setCategory(e.target.value)} className="input" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Selling rate" hint="Per unit, before any discount">
          <input type="number" min={0} step="0.01" value={price} className="input"
            onChange={e => setPrice(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <Field label="MRP" hint="Optional, for reference">
          <input type="number" min={0} step="0.01" value={mrp} className="input"
            onChange={e => setMrp(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Unit">
          <select value={unit} onChange={e => setUnit(e.target.value)} className="select">
            {UNITS.map(value => <option key={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="GST rate">
          <select value={gstRate} onChange={e => setGstRate(Number(e.target.value))} className="select">
            {GST_RATES.map(rate => <option key={rate} value={rate}>{rate}%</option>)}
          </select>
        </Field>
        <Field label="HSN code">
          <input value={hsnCode} onChange={e => setHsnCode(e.target.value)} className="input" placeholder="3304" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Units available"
          hint={product ? `Currently ${held} in stock` : "How many you hold right now"}>
          <input type="number" min={0} step={1} value={stock} className="input"
            onChange={e => setStock(Math.max(0, Math.trunc(Number(e.target.value)) || 0))} />
        </Field>
        <Field label="Reorder level" hint="Warn once stock falls to this. Zero means never.">
          <input type="number" min={0} step={1} value={reorderLevel} className="input"
            onChange={e => setReorderLevel(Math.max(0, Math.trunc(Number(e.target.value)) || 0))} />
        </Field>
      </div>

      {/*
        Saying plainly what the single number means. Reps and doctors are served
        out of the same box in the storeroom, and this figure is that box.
      */}
      <p className="rounded-[10px] bg-[var(--surface-2)] px-3 py-2.5 text-xs text-[var(--ink-2)]">
        This is one pool. Samples issued to a representative and products billed to a doctor both come out of it, so the
        figure here is always what is really left. Record supplier receipts with batch and expiry under{" "}
        <Link href="/admin/inventory" className="font-semibold underline underline-offset-2">Inventory</Link>.
        {movement !== 0 && (
          <span className="mt-1 block font-semibold text-[var(--ink)]">
            Saving will {movement > 0 ? "add" : "remove"} {Math.abs(movement)} unit{Math.abs(movement) === 1 ? "" : "s"}
            {product ? ` and record it as a correction in the stock history.` : "."}
          </span>
        )}
      </p>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
