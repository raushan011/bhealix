"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Building2, Loader2, Search } from "lucide-react";
import { customerTitle, type CustomerRecord } from "@/lib/billing/customers";

/**
 * Type-ahead search over the trade-buyer directory. Deliberately the same shape
 * as the doctor picker beside it, so choosing who to bill feels like one
 * control however the buyer is filed.
 */
export function CustomerPicker({ onSelect, placeholder = "Search stockist, distributor, chemist or individual" }: {
  onSelect: (customer: CustomerRecord) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CustomerRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setItems([]); setLoading(false); setOpen(false); return; }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/customers?q=${encodeURIComponent(term)}&limit=8`, { signal: controller.signal });
        const json = await response.json() as { data?: { items: CustomerRecord[] } };
        setItems(json.data?.items ?? []); setActive(0); setOpen(true); setLoading(false);
      } catch (error) { if ((error as Error).name !== "AbortError") setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) { if (!boxRef.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function choose(customer: CustomerRecord) {
    onSelect(customer); setQuery(""); setItems([]); setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !items.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(i => (i + 1) % items.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(i => (i - 1 + items.length) % items.length); }
    else if (event.key === "Enter") { event.preventDefault(); choose(items[active]); }
    else if (event.key === "Escape") setOpen(false);
  }

  return <div ref={boxRef} className="relative">
    <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" />
    <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
      onFocus={() => { if (items.length) setOpen(true); }}
      placeholder={placeholder} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
      className="input pl-9 pr-9" />
    {loading && <Loader2 size={15} className="absolute right-3 top-3.5 animate-spin text-[var(--muted)]" />}

    {open && (
      <ul id={listId} role="listbox"
        className="absolute z-30 mt-1.5 max-h-80 w-full overflow-y-auto rounded-[10px] border border-[var(--line)] bg-white py-1 shadow-lg">
        {items.length ? items.map((customer, index) => (
          <li key={customer._id} role="option" aria-selected={index === active}>
            <button type="button" onMouseEnter={() => setActive(index)} onClick={() => choose(customer)}
              className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left ${index === active ? "bg-[var(--surface-2)]" : ""}`}>
              <Building2 size={14} className="mt-0.5 shrink-0 text-[var(--brand)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{customerTitle(customer)}</span>
                <span className="block truncate text-xs text-[var(--muted)]">
                  {[customer.type, customer.city, customer.gstin && `GSTIN ${customer.gstin}`].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          </li>
        )) : <li className="px-4 py-3 text-sm text-[var(--muted)]">{loading ? "Searching…" : "No customers found"}</li>}
      </ul>
    )}
  </div>;
}
