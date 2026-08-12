"use client";

import { useState } from "react";
import { MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { MAX_MESSAGE_LENGTH, MERGE_FIELDS, render, unknownFields, type TemplateRecord } from "@/lib/sales/outreach";

/** The lead a preview pretends to be, so the writer sees a real sentence. */
const SAMPLE = { name: "Glow Beauty Studio", area: "Indirapuram", city: "Ghaziabad", type: "Beauty parlour" };

/**
 * Writing the message, and seeing what it will actually look like.
 *
 * The preview is the whole feature. A template is written in a notation
 * (`Hi {{name}}`) and read as a sentence, and the gap between the two is where
 * every embarrassing send comes from — the missing comma, the placeholder
 * spelled `{{Name}}`, the greeting that reads fine until the parlour has no
 * area and it becomes "parlours in ". Showing the rendered version underneath
 * the box costs nothing and closes all three.
 */
export function MessageTemplates({ templates, mayEdit, onChanged, onClose }: {
  templates: TemplateRecord[];
  mayEdit: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<TemplateRecord | "new" | null>(null);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState("");

  async function remove(template: TemplateRecord) {
    setBusyId(template._id); setError("");
    try {
      const response = await fetch(`/api/sales/templates/${template._id}`, { method: "DELETE" });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "That message could not be removed");
      onChanged();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That message could not be removed");
    } finally {
      setBusyId(undefined);
    }
  }

  if (editing) {
    return <TemplateForm template={editing === "new" ? null : editing}
      onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); onChanged(); }} />;
  }

  return <Modal title="Messages" description="Write once, send to hundreds — each one filled in with the lead's own details"
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Close</Button>
      {mayEdit && <Button className="flex-1" onClick={() => setEditing("new")}>
        <MessageSquarePlus size={15} />New message
      </Button>}
    </div>}>

    <div className="space-y-3">
      {error && <Notice tone="error">{error}</Notice>}

      {!templates.length ? (
        <EmptyState icon={MessageSquarePlus} title="No messages written yet"
          description="Write the one you keep typing by hand. Use {{name}} and {{area}} where the details go." />
      ) : templates.map(template => (
        <Card key={template._id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="wrap-break-word text-sm font-semibold">{template.name}</p>
                {template.audience && <Badge tone="brand">{template.audience}</Badge>}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap wrap-break-word text-xs text-[var(--ink-2)]">
                {render(template.body, SAMPLE)}
              </p>
            </div>
            {mayEdit && <div className="flex shrink-0 items-center gap-2">
              <button onClick={() => setEditing(template)} aria-label={`Edit ${template.name}`}
                className="tap inline-flex items-center justify-center text-[var(--muted)] hover:text-[var(--brand)]">
                <Pencil size={15} />
              </button>
              <button onClick={() => remove(template)} disabled={busyId === template._id}
                aria-label={`Remove ${template.name}`}
                className="tap inline-flex items-center justify-center text-[var(--muted)] hover:text-[var(--danger-ink)]">
                <Trash2 size={15} />
              </button>
            </div>}
          </div>
        </Card>
      ))}
    </div>
  </Modal>;
}

/** Writing one, with the sentence it produces underneath. */
function TemplateForm({ template, onClose, onSaved }: {
  template: TemplateRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [audience, setAudience] = useState(template?.audience ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const unknown = unknownFields(body);

  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(
        template ? `/api/sales/templates/${template._id}` : "/api/sales/templates",
        {
          method: template ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim(), body: body.trim(), audience: audience.trim() || undefined })
        }
      );
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "That message could not be saved");
      onSaved();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That message could not be saved");
      setBusy(false);
    }
  }

  return <Modal title={template ? "Edit message" : "New message"}
    description="Anything in double braces is filled in for each lead"
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" busy={busy} onClick={save}>Save</Button>
    </div>}>

    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}

      <Field label="Name" hint="What you will pick it by later.">
        <input className="input" value={name} placeholder="Parlour intro"
          onChange={event => setName(event.target.value)} />
      </Field>

      <Field label="For" hint="Optional. The kind of lead this is written for.">
        <input className="input" value={audience} placeholder="Beauty parlour"
          onChange={event => setAudience(event.target.value)} />
      </Field>

      <Field label="Message">
        <textarea className="textarea" rows={6} value={body}
          onChange={event => setBody(event.target.value)}
          placeholder="Hi {{name}}, we're Bhealix — we work with beauty parlours in {{area}}…" />
      </Field>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-[var(--muted)]">Insert:</span>
        {MERGE_FIELDS.map(field => (
          <button key={field.token} type="button" title={field.label}
            onClick={() => setBody(current => `${current}{{${field.token}}}`)}
            className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
            {`{{${field.token}}}`}
          </button>
        ))}
      </div>

      <div className={`text-xs ${body.length > MAX_MESSAGE_LENGTH ? "text-[var(--danger-ink)]" : "text-[var(--muted)]"}`}>
        {body.length} of {MAX_MESSAGE_LENGTH} characters
      </div>

      {unknown.length > 0 && (
        <Notice tone="warning">
          Nothing will fill in {unknown.map(token => `{{${token}}}`).join(", ")} — it will be sent exactly as written.
        </Notice>
      )}

      {body.trim() && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-[var(--muted)]">
            How it reads to {SAMPLE.name}
          </p>
          <div className="rounded-[10px] bg-[var(--brand-soft)] px-3.5 py-3 text-sm whitespace-pre-wrap wrap-break-word">
            {render(body, SAMPLE)}
          </div>
        </div>
      )}
    </div>
  </Modal>;
}
