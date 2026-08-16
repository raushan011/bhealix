"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Plug, Trash2, XCircle } from "lucide-react";
import { Badge, Button, Card, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { PasswordInput } from "@/components/ui/password-input";
import type { ConnectionSummary } from "@/lib/finance/connections";

/**
 * The vendor API keys.
 *
 * One card per supplier, and every field on it comes from the connector rather
 * than from this file — the four vendors want four completely different sets of
 * credentials, and a form hand-written per vendor is four forms to keep in step
 * with four secret stores. Adding a fifth supplier puts a card here with no
 * change to this component at all.
 *
 * A secret is never sent back to the browser. What the form shows is that one is
 * stored and the last four characters of it, and leaving the box empty on save
 * keeps whatever is there — which is what makes it possible to change a shop
 * domain without retyping a token.
 */

const shortDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";

export function Connections() {
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  /** Edits per connector, keyed by field. Absent means "as stored". */
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});

  const load = useCallback(async () => {
    const response = await fetch("/api/finance/connections");
    const json = await response.json() as { data?: { connections: ConnectionSummary[] }; error?: string };
    if (json.data) setConnections(json.data.connections);
    else setNotice({ tone: "error", text: json.error ?? "Could not read the connections." });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const draftFor = (connection: ConnectionSummary) => drafts[connection.connector] ?? {};

  function edit(connector: string, field: string, value: string) {
    setDrafts(current => ({ ...current, [connector]: { ...current[connector], [field]: value } }));
  }

  function apply(next: ConnectionSummary[], connector: string) {
    setConnections(next);
    // The draft is cleared on a successful save, so the boxes go back to showing
    // what is stored rather than what was typed a moment ago.
    setDrafts(current => ({ ...current, [connector]: {} }));
  }

  async function save(connection: ConnectionSummary, test: boolean) {
    setNotice(null);
    const values = { ...connection.values, ...draftFor(connection) };

    const response = await fetch("/api/finance/connections", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ connector: connection.connector, values, test })
    });
    const json = await response.json() as {
      data?: { ok?: boolean; message?: string; connections: ConnectionSummary[] }; error?: string;
    };

    if (!response.ok || !json.data) {
      return setNotice({ tone: "error", text: json.error ?? "Could not save that key." });
    }

    apply(json.data.connections, connection.connector);
    setNotice(json.data.message
      ? { tone: json.data.ok ? "success" : "warning", text: `${connection.label}: ${json.data.message}` }
      : { tone: "success", text: `${connection.label} saved.` });
  }

  async function test(connection: ConnectionSummary) {
    setNotice(null);
    const response = await fetch("/api/finance/connections", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ connector: connection.connector })
    });
    const json = await response.json() as {
      data?: { ok: boolean; message: string; connections: ConnectionSummary[] }; error?: string;
    };

    if (!response.ok || !json.data) {
      return setNotice({ tone: "error", text: json.error ?? "Could not reach that supplier." });
    }
    setConnections(json.data.connections);
    setNotice({
      tone: json.data.ok ? "success" : "warning",
      text: `${connection.label}: ${json.data.message}`
    });
  }

  async function remove(connection: ConnectionSummary) {
    if (!window.confirm(`Remove the stored ${connection.label} key? Fetching that supplier will stop until a new one is entered.`)) return;

    const response = await fetch(`/api/finance/connections?connector=${connection.connector}`, { method: "DELETE" });
    const json = await response.json() as { data?: { connections: ConnectionSummary[] }; error?: string };
    if (!response.ok || !json.data) {
      return setNotice({ tone: "error", text: json.error ?? "Could not remove that key." });
    }
    apply(json.data.connections, connection.connector);
    setNotice({ tone: "success", text: `${connection.label} key removed.` });
  }

  return <div className="space-y-5">
    <PageTitle
      title="Supplier connections"
      subtitle="The API keys the invoice vault fetches with. Stored encrypted, never shown again, and read only by a test or a fetch."
    />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {loading ? <Spinner label="Reading the connections" /> : <div className="space-y-4">
      {connections.map(connection => {
        const draft = draftFor(connection);
        return <Card key={connection.connector} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Plug size={17} className="text-[var(--muted)]" />{connection.label}
              </h2>
              <p className="mt-1 max-w-prose text-sm text-[var(--muted)]">{connection.guidance}</p>
              <a href={connection.consoleUrl} target="_blank" rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)] hover:underline">
                Open {connection.label} <ExternalLink size={14} />
              </a>
            </div>

            <div className="shrink-0 text-right">
              {connection.configured
                ? <Badge tone={connection.lastTestOk === false ? "warn" : "success"}>
                    {connection.lastTestOk === false
                      ? <><XCircle size={12} className="mr-1" /> Key stored, last test failed</>
                      : <><CheckCircle2 size={12} className="mr-1" /> Connected</>}
                  </Badge>
                : <Badge tone="neutral">Not set up</Badge>}
              {connection.lastTestedAt && <p className="mt-1.5 max-w-[240px] text-xs text-[var(--muted)]">
                Tested {shortDate(connection.lastTestedAt)}
                {connection.lastTestMessage ? ` — ${connection.lastTestMessage}` : ""}
              </p>}
              {connection.lastFetchError && <p className="mt-1 max-w-[240px] text-xs text-[var(--warn-ink)]">
                Last fetch: {connection.lastFetchError}
              </p>}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {connection.fields.map(field => (
              <Field key={field.name} label={`${field.label}${field.required ? "" : " (optional)"}`}
                hint={field.secret && connection.hints[field.name]
                  ? `Stored: ${connection.hints[field.name]} — leave blank to keep it`
                  : field.hint}>
                {field.secret
                  ? <PasswordInput
                      value={draft[field.name] ?? ""}
                      onChange={event => edit(connection.connector, field.name, event.target.value)}
                      placeholder={connection.hints[field.name] ? "•••• leave blank to keep" : field.placeholder}
                      autoComplete="off"
                    />
                  : <input className="input"
                      value={draft[field.name] ?? connection.values[field.name] ?? ""}
                      onChange={event => edit(connection.connector, field.name, event.target.value)}
                      placeholder={field.placeholder}
                    />}
              </Field>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => save(connection, true)}>Save &amp; test</Button>
            <Button tone="secondary" onClick={() => save(connection, false)}>Save</Button>
            <Button tone="ghost" onClick={() => test(connection)} disabled={!connection.configured}>Test connection</Button>
            {connection.configured && <button onClick={() => remove(connection)}
              aria-label={`Remove the ${connection.label} key`} title="Remove the stored key"
              className="tap ml-auto grid place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--danger-ink)]">
              <Trash2 size={16} />
            </button>}
          </div>
        </Card>;
      })}
    </div>}

    <Card className="p-5">
      <h2 className="text-sm font-semibold">What a fetch can and cannot bring back</h2>
      <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
        <li>· <strong>Shiprocket order invoices</strong> come back as Shiprocket&rsquo;s own tax invoice PDFs — the document credit is claimed on.</li>
        <li>· <strong>Razorpay, Shopify and Meta</strong> publish the figures on an API and the tax invoice only in their dashboard. A fetch builds a statement of every transaction with its fee and tax, which ties to the bank line — and the vault goes on asking for the PDF, because a statement is not an invoice.</li>
        <li>· Anything else — rent, the accountant&rsquo;s own fee, a manual courier bill — is filed by hand from the vault under <strong>Offline &amp; other</strong>.</li>
        <li>· Keys are encrypted with <code>AUTH_SECRET</code> and never sent back to a browser. Rotating that secret makes them unreadable, and they are re-entered here.</li>
      </ul>
    </Card>
  </div>;
}
