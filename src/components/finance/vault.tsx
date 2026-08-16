"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Download, ExternalLink, FileArchive, FileText, Plug, Plus, RefreshCw, Send, Trash2, Undo2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, LinkButton, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { UploadInvoice } from "./upload-invoice";
import { formatBytes } from "@/lib/finance/files";
import { financialYearOf, formatPeriod, isPeriod } from "@/lib/finance/period";
import { SOURCES_BY_VENDOR, sourceOf, type SourceKey } from "@/lib/finance/sources";
import type { VaultDocument, VaultSummary } from "@/lib/finance/types";

/**
 * The invoice vault: one month of everything this company was billed, with the
 * gaps showing.
 *
 * The screen is arranged around the job rather than around the data. A month is
 * gathered over three weeks, in odd moments, by somebody with four vendor
 * dashboards open — so the checklist comes first and says what is *missing*,
 * because that is the only part nobody can work out for themselves. The table of
 * what has been filed comes second. The archive button is at the top, where it
 * is on the day the accountant asks.
 *
 * Everything is one month at a time, deliberately. An accountant works in
 * months, the vendors bill in months, and a screen showing all of it at once
 * would answer no question anybody actually has.
 */

type Payload = { period: string; documents: VaultDocument[]; summary: VaultSummary; periods: string[] };
type Flash = { tone: "success" | "warning" | "error" | "info"; text: string };

const rupees = (value: number) =>
  `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const shortDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function Vault({ periods: initialPeriods }: { periods: string[] }) {
  const [period, setPeriod] = useState(initialPeriods[0]);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Flash | null>(null);
  const [filing, setFiling] = useState<SourceKey | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  const load = useCallback(async (which: string) => {
    setLoading(true);
    const response = await fetch(`/api/finance/documents?period=${which}`);
    const json = await response.json() as { data?: Payload; error?: string };
    if (json.data) {
      setPayload(json.data);
      setNote(json.data.summary.note ?? "");
    } else {
      setNotice({ tone: "error", text: json.error ?? "Could not read the vault." });
    }
    // A selection made in August means nothing in September.
    setSelected(new Set());
    setLoading(false);
  }, []);

  /**
   * A month named in the address wins over the newest one.
   *
   * The overview next door links straight at the month being closed, which on
   * the fifth of September is August — landing on September and making somebody
   * change the dropdown would defeat the link. Read off `window` rather than
   * through `useSearchParams`, which would wrap the whole screen in a Suspense
   * boundary for one string; the same reasoning as the Shopify handshake's
   * outcome on the affiliate settings screen.
   */
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("period");
    if (asked && isPeriod(asked)) setPeriod(asked);
  }, []);

  useEffect(() => { load(period); }, [load, period]);

  const summary = payload?.summary;
  const documents = payload?.documents ?? [];

  /** Every month ever filed into, plus this one, so the picker is never empty. */
  const months = useMemo(
    () => [...new Set([...(payload?.periods ?? []), ...initialPeriods])].filter(isPeriod).sort().reverse(),
    [payload?.periods, initialPeriods]
  );

  const lineFor = useCallback(
    (key: SourceKey) => summary?.lines.find(line => line.source === key),
    [summary]
  );

  /**
   * The archive. A plain navigation rather than a fetch, because the browser's
   * own download machinery is what should own a 40 MB file — a fetch would hold
   * the whole thing in the tab's memory first, and show no progress while it did.
   */
  function download(query: string) {
    window.location.href = `/api/finance/archive?${query}`;
  }

  async function pull(source: SourceKey) {
    setNotice(null);
    const response = await fetch("/api/finance/pull", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ period, source })
    });
    const json = await response.json() as { data?: { message: string; stillNeedsPdf?: string }; error?: string };

    if (!response.ok) {
      return setNotice({ tone: "warning", text: json.error ?? "Could not fetch from that supplier." });
    }

    /*
     * A fetch that produced a statement rather than the vendor's own invoice
     * reports as a *warning*, not a success — and says why in the same breath.
     * A green "fetched" beside a source whose tax invoice is still sitting in
     * somebody's dashboard is exactly how a month ends up short of the document
     * the credit is claimed on.
     */
    setNotice(json.data?.stillNeedsPdf
      ? { tone: "warning", text: `${json.data.message} ${json.data.stillNeedsPdf}` }
      : { tone: "success", text: json.data?.message ?? "Fetched." });
    await load(period);
  }

  async function remove(document: VaultDocument) {
    const label = document.number || document.fileName;
    if (!window.confirm(`Delete ${label}? The file goes with it, and this is the paperwork behind a GST claim.`)) return;

    const response = await fetch(`/api/finance/documents/${document.id}`, { method: "DELETE" });
    const json = await response.json() as { error?: string };
    if (!response.ok) return setNotice({ tone: "error", text: json.error ?? "Could not delete that invoice." });

    setNotice({ tone: "success", text: `Deleted ${label}.` });
    await load(period);
  }

  /**
   * Marking the month sent.
   *
   * Answers once with a question when something is missing, and does it when
   * asked again. Sending an incomplete month is a real and frequent act — a
   * vendor is slow and the return will not wait — so refusing outright would be
   * wrong, and going ahead silently would make the checklist above decorative.
   */
  async function handOver(handedOver: boolean, force = false) {
    setNotice(null);
    const response = await fetch("/api/finance/periods", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ period, handedOver, force })
    });
    const json = await response.json() as { data?: { confirm?: boolean; message: string }; error?: string };
    if (!response.ok) return setNotice({ tone: "error", text: json.error ?? "Could not save that." });

    if (json.data?.confirm) {
      if (!window.confirm(json.data.message)) return;
      return handOver(handedOver, true);
    }

    setNotice({ tone: "success", text: json.data?.message ?? "Saved." });
    await load(period);
  }

  async function saveNote() {
    const response = await fetch("/api/finance/periods", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ period, note: note.trim() || null })
    });
    const json = await response.json() as { error?: string };
    setNotice(response.ok
      ? { tone: "success", text: "Note saved." }
      : { tone: "error", text: json.error ?? "Could not save the note." });
  }

  function toggle(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return <div className="space-y-5">
    <PageTitle
      title="Invoice vault"
      subtitle="Every bill this company was sent — Shiprocket, Razorpay, Shopify, Meta and anything offline — filed by month and downloadable as one archive for the accountant."
      actions={<>
        <select className="select max-w-[190px]" value={period} onChange={event => setPeriod(event.target.value)} aria-label="Accounting month">
          {months.map(month => <option key={month} value={month}>{formatPeriod(month)}</option>)}
        </select>
        <LinkButton tone="ghost" href="/admin/control/connections"><Plug size={16} /> Connections</LinkButton>
        <Button tone="secondary" onClick={() => download(`period=${period}`)} disabled={!summary?.documents}>
          <FileArchive size={16} /> Download month
        </Button>
      </>}
    />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {loading || !summary ? <Spinner label="Reading the vault" /> : <>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Documents filed" value={summary.documents} />
            <Stat label="Total billed" value={rupees(summary.amount)} />
            <Stat label="Of which tax" value={rupees(summary.taxAmount)} />
            <Stat label="Archive size" value={formatBytes(summary.bytes)} />
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-[var(--muted)]">Financial year {financialYearOf(period)}</p>
            {summary.handedOverAt
              ? <p className="mt-1 text-sm font-semibold text-[var(--ok-ink)]">
                  Sent {shortDate(summary.handedOverAt)}{summary.handedOverBy ? ` by ${summary.handedOverBy}` : ""}
                </p>
              : <p className="mt-1 text-sm text-[var(--muted)]">Not sent to the accountant yet</p>}
            <div className="mt-2 flex justify-end">
              {summary.handedOverAt
                ? <Button tone="ghost" onClick={() => handOver(false)}><Undo2 size={15} /> Reopen</Button>
                : <Button tone="secondary" onClick={() => handOver(true)}><Send size={15} /> Mark sent to CA</Button>}
            </div>
          </div>
        </div>

        {summary.missing.length > 0 && <div className="mt-4">
          <Notice tone="warning">
            {formatPeriod(period)} has nothing filed for{" "}
            {summary.missing.map(key => `${sourceOf(key).vendor} ${sourceOf(key).label.toLowerCase()}`).join(", ")}.
          </Notice>
        </div>}

        <div className="mt-4">
          <Field label="Note on this month" hint="What is still outstanding, or anything the next person needs to know">
            <textarea className="textarea" value={note} onChange={event => setNote(event.target.value)}
              placeholder="e.g. Meta receipt still to come — card statement attached in the meantime" />
          </Field>
          <div className="mt-2 flex justify-end"><Button tone="ghost" onClick={saveNote}>Save note</Button></div>
        </div>
      </Card>

      {/* The checklist. Sources with nothing filed are the whole point, so they
          are drawn exactly as prominently as the ones that are done. */}
      <div className="space-y-4">
        {SOURCES_BY_VENDOR.map(({ vendor, sources }) => <div key={vendor}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted)]">{vendor}</h2>
            {vendor !== "Other" && <button onClick={() => download(`period=${period}&vendor=${encodeURIComponent(vendor)}`)}
              className="text-xs font-semibold text-[var(--brand)] hover:underline">
              Download {vendor} only
            </button>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sources.map(source => {
              const line = lineFor(source.key);
              const filed = (line?.count ?? 0) > 0;

              return <Card key={source.key} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{source.label}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {filed
                        ? `${line!.count} document${line!.count === 1 ? "" : "s"} · ${line!.unpriced ? "no amount recorded" : rupees(line!.amount)}`
                        : source.expected ? "Nothing filed" : "Nothing filed (not expected)"}
                    </p>
                  </div>
                  {filed
                    ? <Badge tone="success"><CheckCircle2 size={12} className="mr-1" /> Filed</Badge>
                    : source.expected
                      ? <Badge tone="warn"><CircleAlert size={12} className="mr-1" /> Missing</Badge>
                      : <Badge tone="neutral">Optional</Badge>}
                </div>

                <p className="text-xs leading-relaxed text-[var(--muted)]">{source.blurb}</p>

                {/*
                  * Said on the card, not only after a fetch. A source whose API
                  * gives the figures but not the invoice needs its PDF filed
                  * whatever the Fetch button reports, and somebody deciding
                  * whether a month is finished is reading this card rather than
                  * a notice that has since scrolled away.
                  */}
                {source.stillNeedsPdf && <p className="rounded-[8px] bg-[var(--warn-bg)] px-2.5 py-2 text-xs leading-relaxed text-[var(--warn-ink)]">
                  {source.stillNeedsPdf}
                </p>}

                <div className="mt-auto flex flex-wrap items-center gap-2">
                  {source.connector
                    ? <Button tone="secondary" onClick={() => pull(source.key)}>
                        <RefreshCw size={15} /> {source.yields === "document" ? "Fetch invoices" : "Fetch figures"}
                      </Button>
                    : null}
                  <Button tone={source.connector ? "ghost" : "secondary"} onClick={() => setFiling(source.key)}>
                    <Plus size={15} /> File one
                  </Button>
                  {source.billingUrl && <a href={source.billingUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--muted)] hover:text-[var(--brand)]">
                    Their portal <ExternalLink size={12} />
                  </a>}
                </div>
              </Card>;
            })}
          </div>
        </div>)}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <h2 className="text-base font-semibold">Filed for {formatPeriod(period)}</h2>
          {selected.size > 0 && <Button tone="secondary" onClick={() => download(`ids=${[...selected].join(",")}`)}>
            <Download size={15} /> Download {selected.size} selected
          </Button>}
        </div>

        {!documents.length
          ? <EmptyState icon={FileText} title="Nothing filed for this month yet"
              description="Use “File one” on any card above, or pull Shiprocket's order invoices." />
          : <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input type="checkbox" aria-label="Select every invoice"
                        checked={selected.size === documents.length}
                        onChange={event => setSelected(event.target.checked ? new Set(documents.map(row => row.id)) : new Set())} />
                    </th>
                    <th className="px-3 py-3 font-semibold">Source</th>
                    <th className="px-3 py-3 font-semibold">Number</th>
                    <th className="px-3 py-3 font-semibold">Date</th>
                    <th className="px-3 py-3 text-right font-semibold">Amount</th>
                    <th className="px-3 py-3 text-right font-semibold">Tax</th>
                    <th className="px-3 py-3 font-semibold">Filed</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {documents.map(row => {
                    const source = sourceOf(row.source);
                    return <tr key={row.id} className="border-b border-[var(--line)] last:border-0">
                      <td className="px-4 py-3">
                        <input type="checkbox" aria-label={`Select ${row.fileName}`}
                          checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium">{source.label}</p>
                        <p className="text-xs text-[var(--muted)]">{source.vendor}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium">{row.number || "—"}</p>
                        {row.description && <p className="max-w-[260px] truncate text-xs text-[var(--muted)]">{row.description}</p>}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{shortDate(row.documentDate)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.amount == null ? "—" : rupees(row.amount)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.taxAmount == null ? "—" : rupees(row.taxAmount)}</td>
                      <td className="px-3 py-3">
                        <Badge tone={row.origin === "pulled" ? "info" : "neutral"}>
                          {row.origin === "pulled" ? "Pulled" : "By hand"}
                        </Badge>
                        <p className="mt-1 text-xs text-[var(--muted)]">{formatBytes(row.bytes)}</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <a href={`/api/finance/documents/${row.id}`} target="_blank" rel="noreferrer"
                            title="Open" aria-label={`Open ${row.fileName}`}
                            className="tap grid place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]">
                            <FileText size={16} />
                          </a>
                          <a href={`/api/finance/documents/${row.id}?download=1`}
                            title="Download" aria-label={`Download ${row.fileName}`}
                            className="tap grid place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]">
                            <Download size={16} />
                          </a>
                          <button onClick={() => remove(row)} title="Delete" aria-label={`Delete ${row.fileName}`}
                            className="tap grid place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--danger-ink)]">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>}
      </Card>
    </>}

    {filing && <UploadInvoice
      period={period}
      source={filing}
      onClose={() => setFiling(null)}
      onFiled={(message, drift) => {
        setFiling(null);
        setNotice(drift ? { tone: "warning", text: `${message} ${drift}` } : { tone: "success", text: message });
        load(period);
      }}
    />}
  </div>;
}
