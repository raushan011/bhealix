"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Inbox, ListChecks, MessageSquare, Pencil, Plug, Plus,
  RefreshCw, Send, Settings2, Trash2, XCircle, Zap
} from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { PasswordInput } from "@/components/ui/password-input";
import { MERGE_FIELDS } from "@/lib/sales/outreach";
import {
  OUTREACH_STATUSES, previewMetaBody, templateValues, type MetaTemplate, type OutreachStatus
} from "@/lib/sales/automation";
import type {
  AutomationOverview, AutomationRuleRecord, OutreachMessageRecord, OutreachReplyRecord
} from "@/lib/sales/types";

/**
 * The automation panel: messages that go out with nobody pressing send, and
 * everything anybody will ever ask about them.
 *
 * Four tabs, one per question. *Overview* is "is it on, what are the rules,
 * what has it done"; *Messages* is the log of every send with what Meta said
 * became of it; *Replies* is the inbox of what came back; *Setup* is the Meta
 * credentials and the webhook address, visited once and then on the day the
 * token expires.
 *
 * A deliberate asymmetry with the manual Send tab: that one needs no Meta
 * account and works today from any phone; this one needs the Cloud API set up
 * once, and from then on the sending is nobody's job. Both write the same
 * `lastContactedAt`, so neither can message a shop the other already reached.
 */
export function AutomationScreen() {
  const [tab, setTab] = useState<"overview" | "messages" | "replies" | "setup">("overview");
  const [data, setData] = useState<AutomationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/sales/automation");
    const json = await response.json() as { data?: AutomationOverview };
    setData(json.data ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const say = (tone: "success" | "warning" | "error", text: string) => setNotice({ tone, text });

  const tabs = [
    ["overview", "Overview", Zap] as const,
    ["messages", "Messages", MessageSquare] as const,
    ["replies", "Replies", Inbox] as const,
    ["setup", "Setup", Settings2] as const
  ];

  return <div className="space-y-5">
    <PageTitle title="Automation"
      subtitle="Save a search, and the messages go out on their own — this is where you watch them and what came back" />

    <div className="flex gap-1.5 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-1">
      {tabs.map(([value, label, Icon]) => (
        <button key={value} type="button" onClick={() => { setTab(value); setNotice(null); }} aria-pressed={tab === value}
          className={`flex min-h-[40px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1 text-[13px] font-semibold transition-colors sm:gap-2 sm:text-sm ${
            tab === value ? "bg-[var(--brand)] text-[var(--on-brand)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
          }`}>
          <Icon size={15} className="shrink-0" />
          <span className="truncate">{label}</span>
          {value === "replies" && (data?.counts.unreadReplies ?? 0) > 0 && (
            <span className="ml-0.5 inline-flex min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[var(--danger-bg)] px-1.5 text-[11px] font-bold text-[var(--danger-ink)]">
              {data?.counts.unreadReplies}
            </span>
          )}
        </button>
      ))}
    </div>

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {loading ? <Spinner label="Loading the automation panel…" /> : !data ? (
      <Notice tone="error">Could not load the automation panel.</Notice>
    ) : <>
      {tab === "overview" && <Overview data={data} onChanged={load} say={say} goSetup={() => setTab("setup")} />}
      {tab === "messages" && <MessagesLog rules={data.rules} />}
      {tab === "replies" && <RepliesInbox onSeen={load} />}
      {tab === "setup" && <Setup data={data} onChanged={load} say={say} />}
    </>}
  </div>;
}

// ------------------------------------------------------------------ overview

function Overview({ data, onChanged, say, goSetup }: {
  data: AutomationOverview;
  onChanged: () => Promise<void>;
  say: (tone: "success" | "warning" | "error", text: string) => void;
  goSetup: () => void;
}) {
  const [editing, setEditing] = useState<AutomationRuleRecord | "new" | null>(null);
  const counts = data.counts;

  const toggleAutoSend = async () => {
    const response = await fetch("/api/sales/automation/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoSend: !data.autoSend })
    });
    const json = await response.json() as { error?: string };
    if (!response.ok) return say("error", json.error ?? "Could not change the switch");
    say("success", data.autoSend
      ? "Automatic sending is off. Rules are kept, and nothing goes out until it is switched back on."
      : "Automatic sending is on. Every save of a matching search now messages the new leads.");
    await onChanged();
  };

  const sendNow = async () => {
    const response = await fetch("/api/sales/automation/run", { method: "POST" });
    const json = await response.json() as { error?: string; data?: { sent: number; failed: number; remaining: number; stoppedBecause?: string } };
    if (!response.ok) return say("error", json.error ?? "Could not send");
    const report = json.data;
    if (!report) return;
    const parts = [`${report.sent} sent`];
    if (report.failed) parts.push(`${report.failed} failed`);
    if (report.remaining) parts.push(`${report.remaining} still queued`);
    say(report.failed ? "warning" : "success", `${parts.join(", ")}.${report.stoppedBecause ? ` ${report.stoppedBecause}` : ""}`);
    await onChanged();
  };

  return <div className="space-y-5">
    {!data.connected && (
      <Notice tone="warning">
        WhatsApp is not connected yet, so nothing can actually send. Open{" "}
        <button type="button" onClick={goSetup} className="font-semibold underline">Setup</button> and add the
        Cloud API credentials — it is a one-time job.
      </Notice>
    )}
    {data.lastError && <Notice tone="error">The last run stopped: {data.lastError}</Notice>}

    <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="flex items-center gap-3">
        {data.autoSend && data.connected
          ? <Badge tone="success">Sending automatically</Badge>
          : data.autoSend
            ? <Badge tone="warn">On, but not connected</Badge>
            : <Badge tone="neutral">Switched off</Badge>}
        <span className="text-sm text-[var(--muted)]">
          {counts.sentToday} of {data.dailyCap} today&rsquo;s cap used
          {data.displayNumber ? ` · sending as ${data.displayNumber}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button tone="secondary" onClick={sendNow} disabled={!data.connected || !data.autoSend || counts.queued === 0}>
          <Send size={15} />Send now{counts.queued ? ` (${counts.queued})` : ""}
        </Button>
        <Button tone={data.autoSend ? "secondary" : "primary"} onClick={toggleAutoSend}>
          {data.autoSend ? "Switch off" : "Switch on"}
        </Button>
      </div>
    </Card>

    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Queued" value={counts.queued} />
      <Stat label="Sent" value={counts.sent} />
      <Stat label="Delivered" value={counts.delivered} />
      <Stat label="Read" value={counts.read} tone="text-[var(--ok-ink)]" />
      <Stat label="Replied" value={counts.replied} tone="text-[var(--ok-ink)]" />
      <Stat label="Failed" value={counts.failed} tone={counts.failed ? "text-[var(--danger-ink)]" : undefined} />
    </Card>

    <div className="flex items-center justify-between">
      <h2 className="text-base font-semibold">Rules</h2>
      {editing === null && (
        <Button tone="secondary" onClick={() => setEditing("new")}><Plus size={15} />New rule</Button>
      )}
    </div>

    {editing !== null && (
      <RuleForm
        rule={editing === "new" ? null : editing}
        connected={data.connected}
        onDone={async (saved) => {
          setEditing(null);
          if (saved) await onChanged();
        }}
        say={say}
      />
    )}

    {data.rules.length === 0 && editing === null ? (
      <EmptyState icon={Zap} title="No rules yet"
        description="A rule is a standing instruction: when a lead of this type in this city is saved, send it this approved template. Write the first one and the next search you save messages itself."
        action={<Button onClick={() => setEditing("new")}><Plus size={15} />Write the first rule</Button>} />
    ) : (
      <div className="space-y-3">
        {data.rules.map(rule => (
          <RuleRow key={rule._id} rule={rule} onEdit={() => setEditing(rule)} onChanged={onChanged} say={say} />
        ))}
      </div>
    )}
  </div>;
}

function RuleRow({ rule, onEdit, onChanged, say }: {
  rule: AutomationRuleRecord;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  say: (tone: "success" | "warning" | "error", text: string) => void;
}) {
  const toggle = async () => {
    const response = await fetch(`/api/sales/automation/rules/${rule._id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled })
    });
    if (!response.ok) {
      const json = await response.json() as { error?: string };
      return say("error", json.error ?? "Could not change the rule");
    }
    await onChanged();
  };

  const remove = async () => {
    if (!window.confirm(`Delete the rule "${rule.name}"? What it already sent stays in the log; anything still queued under it is dropped.`)) return;
    const response = await fetch(`/api/sales/automation/rules/${rule._id}`, { method: "DELETE" });
    const json = await response.json() as { error?: string; data?: { queuedDropped: number } };
    if (!response.ok) return say("error", json.error ?? "Could not delete the rule");
    say("success", json.data?.queuedDropped
      ? `Rule deleted, and ${json.data.queuedDropped} queued message${json.data.queuedDropped === 1 ? "" : "s"} dropped with it.`
      : "Rule deleted.");
    await onChanged();
  };

  const runExisting = async () => {
    if (!window.confirm(`Send "${rule.template.name}" to the ${rule.matching} saved lead${rule.matching === 1 ? "" : "s"} this rule matches right now?`)) return;
    const response = await fetch(`/api/sales/automation/rules/${rule._id}`, { method: "POST" });
    const json = await response.json() as {
      error?: string;
      data?: { queued: { queued: number; reason?: string }; drained: { sent: number; failed: number; remaining: number; stoppedBecause?: string } | null };
    };
    if (!response.ok) return say("error", json.error ?? "Could not run the rule");
    const result = json.data;
    if (!result) return;
    if (!result.queued.queued) return say("warning", result.queued.reason ?? "Nothing new to send — everybody matching was already messaged or queued.");
    const drained = result.drained;
    say(drained?.failed ? "warning" : "success",
      `${result.queued.queued} queued${drained ? `, ${drained.sent} sent${drained.failed ? `, ${drained.failed} failed` : ""}${drained.remaining ? `, ${drained.remaining} waiting` : ""}` : ""}.${drained?.stoppedBecause ? ` ${drained.stoppedBecause}` : ""}`);
    await onChanged();
  };

  const scope = [rule.leadType || "every type", rule.city || "everywhere"].join(" · ");

  return <Card className="space-y-3 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold">{rule.name}</h3>
          {rule.enabled ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>}
          {rule.freshOnly && <Badge tone="info">Only never-messaged</Badge>}
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {scope} → template <span className="font-medium text-[var(--ink-2)]">{rule.template.name}</span> ({rule.template.language})
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button tone="secondary" onClick={runExisting} disabled={rule.matching === 0 || !rule.enabled}
          title="Send to the matching leads already saved">
          <Send size={14} />Send to {rule.matching} saved
        </Button>
        <Button tone="secondary" onClick={toggle}>{rule.enabled ? "Switch off" : "Switch on"}</Button>
        <Button tone="secondary" onClick={onEdit}><Pencil size={14} /></Button>
        <Button tone="danger" onClick={remove}><Trash2 size={14} /></Button>
      </div>
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--line)] pt-3 text-sm text-[var(--muted)]">
      <span>{rule.stats.sent} sent</span>
      <span>{rule.stats.replied} replied</span>
      {rule.stats.queued > 0 && <span>{rule.stats.queued} queued</span>}
      {rule.stats.failed > 0 && <span className="text-[var(--danger-ink)]">{rule.stats.failed} failed</span>}
      <span>{rule.matching} saved lead{rule.matching === 1 ? "" : "s"} match{rule.matching === 1 ? "es" : ""} right now</span>
    </div>
  </Card>;
}

// ----------------------------------------------------------------- rule form

/** A lead that reads believably in the preview, standing in for whoever is messaged. */
const SAMPLE = { name: "Glow Beauty Studio", area: "Indirapuram", city: "Ghaziabad", type: "Beauty parlour" };

function RuleForm({ rule, connected, onDone, say }: {
  rule: AutomationRuleRecord | null;
  connected: boolean;
  onDone: (saved: boolean) => Promise<void>;
  say: (tone: "success" | "warning" | "error", text: string) => void;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [leadType, setLeadType] = useState(rule?.leadType ?? "");
  const [city, setCity] = useState(rule?.city ?? "");
  const [freshOnly, setFreshOnly] = useState(rule?.freshOnly ?? true);
  const [templateName, setTemplateName] = useState(rule?.template.name ?? "");
  const [fields, setFields] = useState<string[]>(rule?.template.fields ?? []);
  const [error, setError] = useState("");

  const [templates, setTemplates] = useState<MetaTemplate[] | null>(null);
  const [templatesError, setTemplatesError] = useState("");
  const [types, setTypes] = useState<string[]>([]);

  const loadTemplates = useCallback(async () => {
    setTemplatesError("");
    const response = await fetch("/api/sales/automation/templates");
    const json = await response.json() as { error?: string; data?: { templates: MetaTemplate[] } };
    if (!response.ok) return setTemplatesError(json.error ?? "Could not read the templates from Meta.");
    setTemplates(json.data?.templates ?? []);
  }, []);

  useEffect(() => {
    if (connected) loadTemplates();
    // The trades already saved, so the type filter is picked rather than retyped wrong.
    fetch("/api/sales/leads?limit=1").then(response => response.json())
      .then((json: { data?: { types?: string[] } }) => setTypes(json.data?.types ?? []))
      .catch(() => setTypes([]));
  }, [connected, loadTemplates]);

  const chosen = templates?.find(candidate => candidate.name === templateName);
  const approved = (templates ?? []).filter(candidate => candidate.status === "APPROVED");
  const slots = chosen?.parameterCount ?? (rule && rule.template.name === templateName ? rule.template.fields.length : 0);

  // Choosing a different template resets the mapping to its slot count.
  useEffect(() => {
    if (!chosen) return;
    setFields(current => Array.from({ length: chosen.parameterCount }, (_, index) => current[index] ?? "name"));
  }, [chosen]);

  const body = chosen?.body ?? (rule && rule.template.name === templateName ? rule.template.body : "");
  const preview = body ? previewMetaBody(body, templateValues(fields, SAMPLE)) : "";

  const save = async () => {
    setError("");
    if (!templateName) return setError("Choose an approved template — Meta only lets a business open a conversation with one.");
    const payload = {
      name,
      leadType,
      city,
      freshOnly,
      template: {
        name: templateName,
        language: chosen?.language ?? rule?.template.language ?? "en",
        body,
        fields: fields.slice(0, slots)
      }
    };
    const response = await fetch(rule ? `/api/sales/automation/rules/${rule._id}` : "/api/sales/automation/rules", {
      method: rule ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await response.json() as { error?: string };
    if (!response.ok) return setError(json.error ?? "The rule could not be saved");
    say("success", rule ? "Rule updated." : "Rule saved. It fires on every matching search saved from now on — use “Send to saved” for the leads already on the list.");
    await onDone(true);
  };

  return <Card className="space-y-4 border-[var(--brand)] p-5">
    <h3 className="text-[15px] font-semibold">{rule ? "Edit rule" : "New rule"}</h3>

    {!connected && <Notice tone="warning">WhatsApp is not connected, so the template list cannot be read. The rule can still be written; connect on the Setup tab before switching it on.</Notice>}
    {templatesError && (
      <Notice tone="error">
        {templatesError}{" "}
        <button type="button" onClick={loadTemplates} className="font-semibold underline">Try again</button>
      </Notice>
    )}

    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Rule name" hint="For the list on this screen — the lead never sees it.">
        <input className="input" value={name} onChange={event => setName(event.target.value)} placeholder="Parlours — partner invitation" />
      </Field>
      <Field label="Lead type" hint="Leave blank to fire for every type.">
        <input className="input" list="automation-lead-types" value={leadType} onChange={event => setLeadType(event.target.value)} placeholder="Every type" />
        <datalist id="automation-lead-types">
          {types.map(type => <option key={type} value={type} />)}
        </datalist>
      </Field>
      <Field label="City" hint="Leave blank for everywhere.">
        <input className="input" value={city} onChange={event => setCity(event.target.value)} placeholder="Everywhere" />
      </Field>
      <Field label="Message template" hint={templates === null && connected ? "Reading the templates from Meta…" : "Only templates Meta has approved can be sent."}>
        <select className="select" value={templateName} onChange={event => setTemplateName(event.target.value)}>
          <option value="">Choose a template…</option>
          {rule && !approved.some(candidate => candidate.name === rule.template.name) && (
            <option value={rule.template.name}>{rule.template.name} (as saved)</option>
          )}
          {approved.map(candidate => (
            <option key={`${candidate.name}:${candidate.language}`} value={candidate.name}>
              {candidate.name} ({candidate.language})
            </option>
          ))}
        </select>
      </Field>
    </div>

    {(templates ?? []).some(candidate => candidate.status !== "APPROVED") && (
      <p className="text-xs text-[var(--muted)]">
        Waiting on Meta&rsquo;s approval:{" "}
        {(templates ?? []).filter(candidate => candidate.status !== "APPROVED").map(candidate => `${candidate.name} (${candidate.status.toLowerCase()})`).join(", ")}.
        Templates are written and submitted in Meta&rsquo;s WhatsApp Manager, not here.
      </p>
    )}

    {slots > 0 && (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: slots }, (_, index) => (
          <Field key={index} label={`Blank {{${index + 1}}} takes`}>
            <select className="select" value={fields[index] ?? "name"}
              onChange={event => setFields(current => current.map((value, position) => position === index ? event.target.value : value))}>
              {MERGE_FIELDS.map(field => <option key={field.token} value={field.token}>{field.label}</option>)}
            </select>
          </Field>
        ))}
      </div>
    )}

    {preview && (
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-[var(--ink-2)]">How it will read</p>
        <div className="whitespace-pre-wrap rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm">
          {preview}
        </div>
      </div>
    )}

    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" checked={freshOnly} onChange={event => setFreshOnly(event.target.checked)} className="mt-0.5" />
      <span>
        <span className="font-medium">Only leads never messaged before</span>
        <span className="block text-xs text-[var(--muted)]">By hand or by any rule. Keep this on — the same shop twice in a week is what gets a number&rsquo;s quality rating downgraded.</span>
      </span>
    </label>

    {error && <Notice tone="error">{error}</Notice>}

    <div className="flex gap-2">
      <Button onClick={save}>{rule ? "Save changes" : "Save rule"}</Button>
      <Button tone="secondary" onClick={() => onDone(false)}>Cancel</Button>
    </div>
  </Card>;
}

// ------------------------------------------------------------------ messages

const statusTone = (status: OutreachStatus): "neutral" | "info" | "success" | "danger" => {
  switch (status) {
    case "Queued": return "neutral";
    case "Sent": return "info";
    case "Delivered": case "Read": return "success";
    case "Failed": return "danger";
  }
};

const when = (value?: string) => value
  ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
  : "";

function MessagesLog({ rules }: { rules: AutomationRuleRecord[] }) {
  const [filters, setFilters] = useState({ status: "", rule: "", replied: "", q: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: OutreachMessageRecord[]; total: number; pages: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const query = useMemo(() => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) search.set(key, value);
    search.set("page", String(page));
    search.set("limit", "50");
    return search.toString();
  }, [filters, page]);

  useEffect(() => {
    let stale = false;
    fetch(`/api/sales/automation/messages?${query}`)
      .then(response => response.json())
      .then((json: { data?: { items: OutreachMessageRecord[]; total: number; pages: number } }) => {
        if (!stale) { setData(json.data ?? null); setLoading(false); }
      })
      .catch(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [query]);

  const set = (key: keyof typeof filters) => (value: string) => { setPage(1); setFilters(current => ({ ...current, [key]: value })); };

  return <div className="space-y-4">
    <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Search">
        <input className="input" value={filters.q} placeholder="Name, city or number" onChange={event => set("q")(event.target.value)} />
      </Field>
      <Field label="Status">
        <select className="select" value={filters.status} onChange={event => set("status")(event.target.value)}>
          <option value="">Any</option>
          {OUTREACH_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
        </select>
      </Field>
      <Field label="Rule">
        <select className="select" value={filters.rule} onChange={event => set("rule")(event.target.value)}>
          <option value="">Any rule</option>
          {rules.map(rule => <option key={rule._id} value={rule._id}>{rule.name}</option>)}
        </select>
      </Field>
      <Field label="Replied">
        <select className="select" value={filters.replied} onChange={event => set("replied")(event.target.value)}>
          <option value="">Any</option>
          <option value="yes">Wrote back</option>
          <option value="no">No reply yet</option>
        </select>
      </Field>
    </Card>

    {loading ? <Spinner label="Loading messages…" /> : !data || data.items.length === 0 ? (
      <EmptyState icon={MessageSquare} title="Nothing sent yet"
        description="Once a rule fires — on a save, or by Send now — every message lands here with what Meta reported back about it." />
    ) : <>
      <div className="space-y-2.5">
        {data.items.map(message => (
          <Card key={message._id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-semibold">{message.leadName ?? "Unknown lead"}</span>
                <span className="text-sm text-[var(--muted)]">+{message.phone}</span>
                {message.city && <span className="text-sm text-[var(--muted)]">· {message.city}</span>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {message.repliedAt && <Badge tone="brand">Replied</Badge>}
                <Badge tone={statusTone(message.status)}>{message.status}</Badge>
              </div>
            </div>
            {message.preview && <p className="wrap-break-word text-sm text-[var(--ink-2)]">{message.preview}</p>}
            <p className="text-xs text-[var(--muted)]">
              {message.ruleName ? `Rule: ${message.ruleName} · ` : ""}
              {message.sentAt ? `Sent ${when(message.sentAt)}` : `Queued ${when(message.queuedAt)}`}
              {message.readAt ? ` · read ${when(message.readAt)}` : message.deliveredAt ? ` · delivered ${when(message.deliveredAt)}` : ""}
              {message.repliedAt ? ` · replied ${when(message.repliedAt)}` : ""}
            </p>
            {message.error && <Notice tone="error">{message.error}</Notice>}
          </Card>
        ))}
      </div>
      {data.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button tone="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-[var(--muted)]">Page {page} of {data.pages} · {data.total} messages</span>
          <Button tone="secondary" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </>}
  </div>;
}

// ------------------------------------------------------------------- replies

function RepliesInbox({ onSeen }: { onSeen: () => Promise<void> }) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: OutreachReplyRecord[]; total: number; pages: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const search = new URLSearchParams({ page: String(page), limit: "50" });
    if (unreadOnly) search.set("seen", "no");
    const response = await fetch(`/api/sales/automation/replies?${search}`);
    const json = await response.json() as { data?: { items: OutreachReplyRecord[]; total: number; pages: number } };
    setData(json.data ?? null);
    setLoading(false);
  }, [page, unreadOnly]);
  useEffect(() => { load(); }, [load]);

  const markAll = async () => {
    await fetch("/api/sales/automation/replies", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" });
    await Promise.all([load(), onSeen()]);
  };

  const unread = (data?.items ?? []).some(reply => !reply.seen);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={unreadOnly} onChange={event => { setPage(1); setUnreadOnly(event.target.checked); }} />
        Unread only
      </label>
      {unread && <Button tone="secondary" onClick={markAll}><ListChecks size={15} />Mark all read</Button>}
    </div>

    {loading ? <Spinner label="Loading replies…" /> : !data || data.items.length === 0 ? (
      <EmptyState icon={Inbox} title={unreadOnly ? "Nothing unread" : "No replies yet"}
        description="When somebody answers an automated message it lands here — and on the lead's own remarks, so the thread reads whole either way." />
    ) : <>
      <div className="space-y-2.5">
        {data.items.map(reply => (
          <Card key={reply._id} className={`space-y-1.5 p-4 ${reply.seen ? "" : "border-[var(--brand)]"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-semibold">{reply.leadName ?? reply.profileName ?? `+${reply.phone}`}</span>
                {reply.profileName && reply.leadName && <span className="text-sm text-[var(--muted)]">({reply.profileName} on WhatsApp)</span>}
                <span className="text-sm text-[var(--muted)]">+{reply.phone}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!reply.seen && <Badge tone="brand">New</Badge>}
                <span className="text-xs text-[var(--muted)]">{when(reply.receivedAt)}</span>
              </div>
            </div>
            <p className="wrap-break-word text-sm">{reply.text}</p>
          </Card>
        ))}
      </div>
      {data.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button tone="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-[var(--muted)]">Page {page} of {data.pages} · {data.total} replies</span>
          <Button tone="secondary" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </>}
  </div>;
}

// --------------------------------------------------------------------- setup

function Setup({ data, onChanged, say }: {
  data: AutomationOverview;
  onChanged: () => Promise<void>;
  say: (tone: "success" | "warning" | "error", text: string) => void;
}) {
  const [phoneNumberId, setPhoneNumberId] = useState(data.phoneNumberId);
  const [businessAccountId, setBusinessAccountId] = useState(data.businessAccountId);
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState(data.verifyToken);
  const [dailyCap, setDailyCap] = useState(data.dailyCap);
  const [test, setTest] = useState<{ ok: boolean; message: string } | "busy" | null>(null);

  const save = async () => {
    const response = await fetch("/api/sales/automation/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phoneNumberId, businessAccountId, verifyToken, dailyCap,
        ...(accessToken ? { accessToken } : {}),
        ...(appSecret ? { appSecret } : {})
      })
    });
    const json = await response.json() as { error?: string };
    if (!response.ok) return say("error", json.error ?? "The settings could not be saved");
    setAccessToken(""); setAppSecret("");
    say("success", "Saved. Press Test connection to check the credentials against Meta.");
    await onChanged();
  };

  const runTest = async () => {
    setTest("busy");
    const response = await fetch("/api/sales/automation/settings", { method: "POST" });
    const json = await response.json() as { error?: string; data?: { ok: boolean; message: string } };
    setTest(response.ok && json.data ? json.data : { ok: false, message: json.error ?? "The test could not run" });
    await onChanged();
  };

  return <div className="space-y-5">
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">WhatsApp Business Cloud API</h2>
        {data.connected && data.connectedAt
          ? <Badge tone="success">Connected{data.displayNumber ? ` · ${data.displayNumber}` : ""}</Badge>
          : <Badge tone="neutral">Not connected</Badge>}
      </div>

      <Notice>
        One-time setup, all on Meta&rsquo;s side: create an app on developers.facebook.com, add the WhatsApp
        product, register the business number, and issue a <strong>permanent</strong> System User token from
        Business Settings. Message templates are written and submitted for approval in WhatsApp Manager —
        Meta only lets a business open a conversation with an approved template, which is why the rules here
        pick from that list rather than free text.
      </Notice>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone number ID" hint="From the API Setup page — the Cloud API's id for the number, not the number itself.">
          <input className="input" value={phoneNumberId} onChange={event => setPhoneNumberId(event.target.value)} />
        </Field>
        <Field label="WhatsApp Business Account ID" hint="Next to the phone number id on the same page.">
          <input className="input" value={businessAccountId} onChange={event => setBusinessAccountId(event.target.value)} />
        </Field>
        <Field label="Access token" hint={data.accessTokenSet ? `Stored (${data.accessTokenHint}). Paste a new one to replace it; blank leaves it.` : "A permanent System User token — the temporary one from API Setup dies in a day."}>
          <PasswordInput value={accessToken} onChange={event => setAccessToken(event.target.value)} placeholder={data.accessTokenSet ? "Stored" : ""} autoComplete="off" />
        </Field>
        <Field label="App secret" hint={data.appSecretSet ? "Stored. Paste a new one to replace it; blank leaves it." : "From the app's Basic Settings — it is what proves a webhook post really came from Meta."}>
          <PasswordInput value={appSecret} onChange={event => setAppSecret(event.target.value)} placeholder={data.appSecretSet ? "Stored" : ""} autoComplete="off" />
        </Field>
        <Field label="Webhook verify token" hint="Any phrase you invent. Type the same one into Meta's webhook configuration.">
          <input className="input" value={verifyToken} onChange={event => setVerifyToken(event.target.value)} placeholder="e.g. bhealix-wa-hook" />
        </Field>
        <Field label="Daily cap" hint="At most this many automated messages a day. Keep it at or under Meta's tier for the number — the test says what that is.">
          <input className="input" type="number" min={1} max={10000} value={dailyCap}
            onChange={event => setDailyCap(Math.max(1, Number(event.target.value) || 1))} />
        </Field>
      </div>

      <Field label="Webhook address" hint="Paste this as the Callback URL in the app's WhatsApp → Configuration, with the verify token above, and subscribe to the messages field. That is what brings delivery status and replies back here.">
        <input className="input" readOnly value={data.webhookUrl} onFocus={event => event.target.select()} />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save}>Save</Button>
        <Button tone="secondary" onClick={runTest} busy={test === "busy"}><Plug size={15} />Test connection</Button>
      </div>

      {test && test !== "busy" && (
        <Notice tone={test.ok ? "success" : "error"}>
          {test.ok ? <CheckCircle2 size={15} className="mr-1 inline" /> : <XCircle size={15} className="mr-1 inline" />}
          {test.message}
        </Notice>
      )}
    </Card>

    <Card className="space-y-2 p-5 text-sm text-[var(--muted)]">
      <h3 className="text-[15px] font-semibold text-[var(--ink)]">How the pieces fit</h3>
      <p>
        <RefreshCw size={13} className="mr-1 inline" />
        When a search is saved on the Leads screen, every new lead is offered to the rules; whatever matches is
        queued and sent in the same breath, inside the daily cap. A scheduled run every three hours picks up
        anything the cap or an outage left waiting.
      </p>
      <p>
        <AlertTriangle size={13} className="mr-1 inline" />
        Sends count against Meta&rsquo;s per-number limit and its quality rating. The rating drops when people
        block or report the number — which is why rules default to never-messaged leads only, and why the manual
        Send tab and this panel share one &ldquo;last messaged&rdquo; date per lead.
      </p>
    </Card>
  </div>;
}
