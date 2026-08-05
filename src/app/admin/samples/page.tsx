"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, Plus, ScrollText, SlidersHorizontal, Undo2, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate, todayIso } from "@/lib/time";
import { can, type Role } from "@/constants/access";
import { MOVEMENT_LABEL, utilisation, type ManualMovementType, type MovementType, type StockRow } from "@/lib/samples/movements";

type TeamStock = { employee: string; name: string; employeeId: string; rows: StockRow[]; issued: number; dispensed: number; balance: number };
type Movement = {
  _id: string; type: MovementType; productName: string; quantity: number;
  batchNo?: string; expiryAt?: string; occurredAt: string; notes?: string;
  employee?: { name: string; employeeId: string } | null;
  doctor?: { name: string } | null;
  actor?: { name: string } | null;
};
type Person = { _id: string; name: string; employeeId: string };
/** `stock` is the company pool — the same units a bill to a doctor draws on. */
type Product = { _id: string; name: string; stock?: number };

const TABS = [
  { key: "stock", label: "Stock on hand", icon: Boxes },
  { key: "ledger", label: "Movement history", icon: ScrollText }
] as const;

const movementTone = (type: MovementType) =>
  type === "ISSUE" ? "info" : type === "DISPENSE" ? "success" : type === "RETURN" ? "warn" : "neutral";

export default function SamplesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("stock");
  const [team, setTeam] = useState<TeamStock[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [recording, setRecording] = useState<ManualMovementType | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [stock, ledger, staff, catalogue, me] = await Promise.all([
      fetch("/api/samples/stock").then(r => r.json()) as Promise<{ data?: { team: TeamStock[] } }>,
      fetch("/api/samples/movements?limit=200").then(r => r.json()) as Promise<{ data?: { items: Movement[] } }>,
      fetch("/api/team?field=1").then(r => r.json()) as Promise<{ data?: { items: Person[] } }>,
      fetch("/api/products").then(r => r.json()) as Promise<{ data?: { items: Product[] } }>,
      fetch("/api/auth/me").then(r => r.json()) as Promise<{ data?: { role: Role } }>
    ]);
    setTeam(stock.data?.team ?? []);
    setMovements(ledger.data?.items ?? []);
    setPeople(staff.data?.items ?? []);
    setProducts(catalogue.data?.items ?? []);
    setRole(me.data?.role ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // HR reads the stock position; only an administrator moves any of it.
  const mayMoveStock = role !== null && can.issueSamples(role);

  const totalIssued = team.reduce((sum, row) => sum + row.issued, 0);
  const totalDispensed = team.reduce((sum, row) => sum + row.dispensed, 0);
  const totalBalance = team.reduce((sum, row) => sum + row.balance, 0);
  const shortfalls = team.filter(row => row.rows.some(product => product.balance < 0)).length;

  return <div className="space-y-5">
    <PageTitle title="Samples" subtitle="What each representative was given, and what reached a doctor"
      actions={mayMoveStock && <>
        <Button tone="secondary" onClick={() => setRecording("ADJUSTMENT")}><SlidersHorizontal size={16} />Adjust</Button>
        <Button tone="secondary" onClick={() => setRecording("RETURN")}><Undo2 size={16} />Record return</Button>
        <Button onClick={() => setRecording("ISSUE")}><Plus size={16} />Issue stock</Button>
      </>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {loading && <Spinner label="Loading sample stock…" />}

    {!loading && <>
      <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
        <Stat label="Issued to reps" value={totalIssued} />
        <Stat label="Given to doctors" value={totalDispensed} tone="text-emerald-700" />
        <Stat label="Still with reps" value={totalBalance} />
        <Stat label="Reaching doctors" value={`${utilisation(totalIssued, totalDispensed)}%`} />
      </Card>

      {shortfalls > 0 && (
        <Notice tone="error">
          {shortfalls} representative{shortfalls === 1 ? " has" : "s have"} handed out more of a product than was
          issued to them. Either the issue was never recorded, or the visit log overstates it — record an adjustment
          once you know which.
        </Notice>
      )}

      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-xs font-semibold ${
              tab === key ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--line-2)] bg-white text-[var(--ink-2)]"
            }`}><Icon size={14} />{label}</button>
        ))}
      </div>

      {tab === "stock" && (team.length
        ? <div className="space-y-4">{team.map(rep => <RepStock key={rep.employee} rep={rep} />)}</div>
        : <EmptyState icon={Boxes} title="No sample stock recorded yet"
            description="Issue stock to a representative to start tracking. What they hand out is then counted automatically from the visits they complete."
            action={mayMoveStock && <Button onClick={() => setRecording("ISSUE")}>Issue stock</Button>} />)}

      {tab === "ledger" && (movements.length ? (
        <Card className="divide-y divide-[var(--line)]">
          {movements.map(row => (
            <div key={row._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5">
              <Badge tone={movementTone(row.type)}>{MOVEMENT_LABEL[row.type]}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {row.productName} × {Math.abs(row.quantity)}
                  {row.type === "ADJUSTMENT" && <span className="ml-1 font-normal text-[var(--muted)]">({row.quantity > 0 ? "added" : "removed"})</span>}
                </p>
                <p className="truncate text-xs text-[var(--muted)]">
                  {[row.employee?.name, row.doctor && `to ${row.doctor.name}`, row.batchNo && `batch ${row.batchNo}`, row.notes]
                    .filter(Boolean).join(" · ")}
                </p>
              </div>
              <p className="shrink-0 text-xs text-[var(--muted)]">{formatDate(row.occurredAt)}</p>
            </div>
          ))}
        </Card>
      ) : <EmptyState icon={ScrollText} title="Nothing recorded yet"
            description="Every issue, hand-over and return will appear here as an audit trail." />)}
    </>}

    {recording && <RecordMovement type={recording} people={people} products={products}
      onClose={() => setRecording(null)}
      onSaved={text => { setRecording(null); setNotice({ tone: "success", text }); load(); }} />}
  </div>;
}

function RepStock({ rep }: { rep: TeamStock }) {
  return <Card className="overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{rep.name}</p>
        <p className="text-xs text-[var(--muted)]">{rep.employeeId}</p>
      </div>
      <div className="flex shrink-0 gap-5 text-right">
        <div><p className="text-xs text-[var(--muted)]">Issued</p><p className="text-sm font-semibold">{rep.issued}</p></div>
        <div><p className="text-xs text-[var(--muted)]">Given out</p><p className="text-sm font-semibold text-emerald-700">{rep.dispensed}</p></div>
        <div><p className="text-xs text-[var(--muted)]">In hand</p>
          <p className={`text-sm font-semibold ${rep.balance < 0 ? "text-rose-700" : ""}`}>{rep.balance}</p></div>
      </div>
    </div>
    <div className="divide-y divide-[var(--line)]">
      {rep.rows.map(row => (
        <div key={row.product} className="flex items-center gap-3 px-5 py-2.5 text-sm">
          <span className="min-w-0 flex-1 truncate">{row.product}</span>
          <span className="shrink-0 text-xs text-[var(--muted)]">
            {row.issued} issued · {row.dispensed} given{row.returned ? ` · ${row.returned} returned` : ""}
            {row.adjusted ? ` · ${row.adjusted > 0 ? "+" : ""}${row.adjusted} adjusted` : ""}
          </span>
          <span className={`w-14 shrink-0 text-right font-semibold ${row.balance < 0 ? "text-rose-700" : ""}`}>{row.balance}</span>
        </div>
      ))}
    </div>
  </Card>;
}

type Line = { product: string; quantity: number; batchNo: string; expiryAt: string };

const COPY: Record<ManualMovementType, { title: string; description: string; submit: string; hint: string }> = {
  ISSUE: {
    title: "Issue stock to a representative",
    description: "What you are handing over now. What they give to doctors is counted from their visits.",
    submit: "Issue stock",
    hint: "Optional — useful for recalls and expiry checks"
  },
  RETURN: {
    title: "Record a return",
    description: "Unused samples coming back from the field.",
    submit: "Record return",
    hint: ""
  },
  ADJUSTMENT: {
    title: "Correct a count",
    description: "For damage, loss, or a stocktake. Use a negative number to take stock away.",
    submit: "Save adjustment",
    hint: ""
  }
};

function RecordMovement({ type, people, products, onClose, onSaved }: {
  type: ManualMovementType; people: Person[]; products: Product[];
  onClose: () => void; onSaved: (text: string) => void;
}) {
  const copy = COPY[type];
  const [employee, setEmployee] = useState(people[0]?._id ?? "");
  const [occurredAt, setOccurredAt] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ product: products[0]?.name ?? "", quantity: 1, batchNo: "", expiryAt: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (index: number, patch: Partial<Line>) =>
    setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line));

  async function submit() {
    if (!employee) { setError("Choose a representative"); return; }
    const filled = lines.filter(line => line.product && line.quantity !== 0);
    if (!filled.length) { setError("Add at least one product"); return; }

    setBusy(true); setError("");
    try {
      const response = await fetch("/api/samples/movements", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type, employee, occurredAt, notes: notes || undefined,
          lines: filled.map(line => ({
            product: line.product,
            quantity: line.quantity,
            batchNo: line.batchNo || undefined,
            expiryAt: line.expiryAt || undefined
          }))
        })
      });
      const json = await response.json() as { error?: string; data?: { employee: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not save this");
      onSaved(`${copy.submit} — ${filled.length} product line${filled.length === 1 ? "" : "s"} for ${json.data?.employee ?? "the rep"}.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save this");
      setBusy(false);
    }
  }

  return <Modal title={copy.title} description={copy.description} onClose={onClose}
    footer={<Button onClick={submit} busy={busy} className="w-full">{busy ? "Saving…" : copy.submit}</Button>}>
    <div className="space-y-4">
      <Field label="Representative">
        <select value={employee} onChange={e => setEmployee(e.target.value)} className="select">
          {people.length
            ? people.map(person => <option key={person._id} value={person._id}>{person.name} ({person.employeeId})</option>)
            : <option value="">No field staff yet</option>}
        </select>
      </Field>

      <Field label="Date"><input type="date" max={todayIso()} value={occurredAt} onChange={e => setOccurredAt(e.target.value)} className="input" /></Field>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-medium text-[var(--ink-2)]">Products</p>
          <button type="button" onClick={() => setLines(current => [...current, { product: products[0]?.name ?? "", quantity: 1, batchNo: "", expiryAt: "" }])}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]"><Plus size={13} />Add line</button>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => {
            // Issuing draws on the same company stock a bill to a doctor does,
            // so the count that matters is shown right where it is spent.
            const available = products.find(product => product.name === line.product)?.stock;
            const short = type === "ISSUE" && available !== undefined && line.quantity > available;

            return <div key={index} className="rounded-[10px] border border-[var(--line)] p-3">
              <div className="flex items-center gap-2">
                <select value={line.product} onChange={e => update(index, { product: e.target.value })} className="select flex-1">
                  {products.length ? products.map(product => <option key={product._id}>{product.name}</option>) : <option value="">No products configured</option>}
                </select>
                <input type="number" value={line.quantity} min={type === "ADJUSTMENT" ? undefined : 1}
                  onChange={e => update(index, { quantity: Number(e.target.value) || 0 })}
                  aria-label="Quantity" className="input w-20 shrink-0" />
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines(current => current.filter((_, i) => i !== index))}
                    aria-label="Remove line" className="tap grid shrink-0 place-items-center rounded-[10px] text-rose-600"><X size={16} /></button>
                )}
              </div>

              {type === "ISSUE" && line.product && (
                <p className={`mt-1.5 text-xs ${short ? "font-semibold text-rose-700" : "text-[var(--muted)]"}`}>
                  {available ?? 0} available in company stock
                  {short ? " — issuing this many will take it below zero" : ""}
                </p>
              )}

              {type === "ISSUE" && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input value={line.batchNo} onChange={e => update(index, { batchNo: e.target.value })}
                    placeholder="Batch number" aria-label="Batch number" className="input" />
                  <input type="date" value={line.expiryAt} onChange={e => update(index, { expiryAt: e.target.value })}
                    aria-label="Expiry date" className="input" />
                </div>
              )}
            </div>;
          })}
        </div>
        {type === "ISSUE" && copy.hint && <p className="mt-1.5 text-xs text-[var(--muted)]">{copy.hint}</p>}
      </div>

      <Field label="Notes (optional)">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} className="textarea" placeholder="Reference number, reason…" />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
