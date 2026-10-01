"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, MapPinned, Plus, Trash2, UserRound } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, LinkButton, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { ASSIGNABLE_ROLES, ROLE_LABEL, mayEditAccount, usesFieldPanel, type Role } from "@/constants/access";

type Member = {
  _id: string; name: string; employeeId: string; email: string; role: Role; active: boolean;
  lastLoginAt?: string; designation?: string; department?: string;
};

const roleTone = (role: Role) =>
  role === "SUPERADMIN" ? "danger" : role === "ADMIN" ? "brand" : role === "HR" ? "info" : role === "EXECUTIVE" ? "success" : "neutral";

/**
 * The directory is everybody now — desk, field and the sales team — so it can
 * be narrowed to the group being looked for.
 */
const GROUPS: { key: string; label: string; test: (member: Member) => boolean }[] = [
  { key: "all", label: "Everyone", test: member => member.active },
  { key: "sales", label: "Sales executives", test: member => member.active && member.role === "EXECUTIVE" },
  { key: "field", label: "Field team", test: member => member.active && usesFieldPanel(member.role) },
  { key: "desk", label: "Desk", test: member => member.active && ["SUPERADMIN", "ADMIN", "HR"].includes(member.role) },
  { key: "inactive", label: "Inactive", test: member => !member.active }
];

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [viewer, setViewer] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [resetting, setResetting] = useState<Member | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/team?active=all");
    const json = await response.json() as { data?: { items: Member[] } };
    setMembers(json.data?.items ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // The field record is the administrator's to read, so HR is not offered a
  // link into a screen that would only send them back.
  useEffect(() => {
    fetch("/api/auth/me").then(response => response.json())
      .then((json: { data?: { role: Role } }) => setViewer(json.data?.role ?? null))
      .catch(() => setViewer(null));
  }, []);

  async function patch(id: string, body: Record<string, unknown>, successText: string) {
    const response = await fetch(`/api/team/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    const json = await response.json() as { error?: string };
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not update" }); return false; }
    setNotice({ tone: "success", text: successText });
    load();
    return true;
  }

  async function remove(member: Member) {
    if (!window.confirm(`Permanently delete ${member.name}? Their scheduled visits are removed and any route plan of theirs returns to draft.`)) return;
    const response = await fetch(`/api/team/${member._id}`, { method: "DELETE" });
    const json = await response.json() as { error?: string };
    // The server refuses when recorded visits would be orphaned, and says why.
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not delete this employee" }); return; }
    setNotice({ tone: "success", text: `${member.name} deleted.` });
    load();
  }

  return <div className="space-y-5">
    <PageTitle title="Employees" subtitle={`${members.filter(m => m.active).length} active — every employee, whichever CRM they work in`}
      actions={<LinkButton href="/admin/team/new"><Plus size={16} />Add employee</LinkButton>} />

    {members.length > 0 && <div className="flex flex-wrap items-center gap-2">
      {GROUPS.map(option => (
        <button key={option.key} onClick={() => setGroup(option.key)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${group === option.key ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`}>
          {option.label} ({members.filter(option.test).length})
        </button>
      ))}
      <input className="input ml-auto !w-full sm:!w-64" placeholder="Search name, ID or email" value={query} onChange={event => setQuery(event.target.value)} />
    </div>}

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {loading && <Spinner label="Loading team…" />}

    {!loading && !members.length && (
      <EmptyState icon={UserRound} title="No employees yet"
        description="Add your team — sales executives, representatives and the desk — with their login, details and salary."
        action={<LinkButton href="/admin/team/new">Add employee</LinkButton>} />
    )}

    {!loading && members.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {members.filter(GROUPS.find(option => option.key === group)?.test ?? (() => true))
          .filter(member => !query.trim() || `${member.name} ${member.employeeId} ${member.email}`.toLowerCase().includes(query.trim().toLowerCase()))
          .map(member => (
          <div key={member._id} className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
            <Link href={`/admin/team/${member._id}`} className="min-w-0 flex-1 basis-full sm:basis-auto">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{member.name}</p>
                <Badge tone={roleTone(member.role)}>{ROLE_LABEL[member.role]}</Badge>
                {!member.active && <Badge tone="danger">Inactive</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {[member.employeeId, member.designation, member.department, member.email].filter(Boolean).join(" · ")}
              </p>
            </Link>
            {/*
             * Five controls come to roughly 370px, which is wider than a phone
             * once the row's padding is taken off. Wrapping them rather than
             * refusing to shrink is what stops the whole card being dragged
             * past the edge of the screen.
             */}
            <div className="flex flex-wrap items-center gap-2">
              {viewer === "ADMIN" && usesFieldPanel(member.role) && (
                <Link href={`/admin/team/${member._id}/activity`} aria-label={`Field activity for ${member.name}`}
                  title="Field activity"
                  className="tap grid place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]">
                  <MapPinned size={16} />
                </Link>
              )}
              {/*
               * A super administrator's row carries no controls at all, for
               * anybody but another super administrator. The API refuses every
               * one of them (see `mayEditAccount`); showing buttons that always
               * fail would only teach people to ignore the error.
               */}
              {mayEditAccount(viewer ?? "HR", member.role) ? <>
                <select value={member.role} aria-label={`Role for ${member.name}`}
                  onChange={e => patch(member._id, { role: e.target.value }, `${member.name} is now ${ROLE_LABEL[e.target.value as Role]}.`)}
                  className="select !min-h-[38px] !py-1 text-xs">
                  {ASSIGNABLE_ROLES.map(role => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
                </select>
                <button onClick={() => setResetting(member)} aria-label={`Reset password for ${member.name}`}
                  className="tap grid place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]"><KeyRound size={16} /></button>
                <Button tone="secondary" className="!min-h-[38px] !px-3 text-xs"
                  onClick={() => patch(member._id, { active: !member.active }, `${member.name} ${member.active ? "deactivated" : "reactivated"}.`)}>
                  {member.active ? "Deactivate" : "Activate"}
                </Button>
                <button onClick={() => remove(member)} aria-label={`Delete ${member.name}`}
                  className="tap grid place-items-center rounded-[10px] text-[var(--danger-ink)] hover:bg-[var(--danger-bg)]"><Trash2 size={16} /></button>
              </> : (
                <p className="text-xs text-[var(--muted)]">Changed from a shell, not from here</p>
              )}
            </div>
          </div>
        ))}
      </Card>
    )}

    {resetting && (
      <ResetPassword member={resetting} onClose={() => setResetting(null)}
        onDone={() => { setResetting(null); setNotice({ tone: "success", text: `Password reset for ${resetting.name}.` }); }} />
    )}
  </div>;
}

function ResetPassword({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(data: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/team/${member._id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: data.get("newPassword") })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not reset the password");
      onDone();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not reset the password");
      setBusy(false);
    }
  }

  return <Modal title="Reset password" description={member.name} onClose={onClose}>
    <form action={submit} className="space-y-4">
      <Field label="New password" hint="Share it with them directly; they can change it after signing in.">
        <input name="newPassword" type="text" minLength={8} required className="input" />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" busy={busy} className="w-full">{busy ? "Saving…" : "Reset password"}</Button>
    </form>
  </Modal>;
}
