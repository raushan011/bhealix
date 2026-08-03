"use client";

import { useEffect, useState } from "react";
import { Package, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";

type Product = { _id: string; name: string; category?: string; sampleAvailable: boolean; active: boolean };

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
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
        ? `${product.name} is used in ${json.data.usedIn} past visit(s), so it was retired instead of deleted — the history stays intact.`
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

  return <div className="space-y-5">
    <PageTitle title="Products" subtitle="What your representatives can discuss and hand out as samples"
      actions={<Button onClick={() => setAdding(true)}><Plus size={16} />Add product</Button>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {loading && <Spinner label="Loading products…" />}

    {!loading && !products.length && (
      <EmptyState icon={Package} title="No products yet"
        description="Add your real BHEALIX range. These are the options a rep picks from when logging what was discussed and which samples were given."
        action={<Button onClick={() => setAdding(true)}>Add product</Button>} />
    )}

    {!loading && products.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {products.map(product => (
          <div key={product._id} className="flex items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{product.name}</p>
                {!product.active && <Badge tone="warn">Retired</Badge>}
              </div>
              {product.category && <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{product.category}</p>}
            </div>
            <Button tone="secondary" className="!min-h-[38px] !px-3 text-xs" onClick={() => toggleActive(product)}>
              {product.active ? "Retire" : "Restore"}
            </Button>
            <button onClick={() => remove(product)} aria-label={`Remove ${product.name}`}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-rose-600 hover:bg-rose-50"><Trash2 size={15} /></button>
          </div>
        ))}
      </Card>
    )}

    {adding && <AddProduct onClose={() => setAdding(false)}
      onAdded={() => { setAdding(false); setNotice({ tone: "success", text: "Product added." }); load(); }} />}
  </div>;
}

function AddProduct({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(data: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/products", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: data.get("name"), category: data.get("category") || undefined })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not add this product");
      onAdded();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not add this product");
      setBusy(false);
    }
  }

  return <Modal title="Add product" description="Use the exact name your team will recognise." onClose={onClose}>
    <form action={submit} className="space-y-4">
      <Field label="Product name"><input name="name" required minLength={2} className="input" /></Field>
      <Field label="Category" hint="Optional — for example Cleanser, Serum, Sun care">
        <input name="category" className="input" />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" busy={busy} className="w-full">{busy ? "Adding…" : "Add product"}</Button>
    </form>
  </Modal>;
}
