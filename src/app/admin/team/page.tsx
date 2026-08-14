"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, MapPinned, Plus, Trash2, UserRound } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { ROLES, ROLE_LABEL, usesFieldPanel, type Role } from "@/constants/access";

type Member = {
  _id: string; name: string; employeeId: string; email: string; role: Role; active: boolean;
  lastLoginAt?: string; designation?: string; department?: string;
};

const roleTone = (role: Role) => role === "ADMIN" ? "brand" : role === "HR" ? "info" : "neutral";

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [viewer, setViewer] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
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
    <PageTitle title="Team" subtitle={`${members.filter(m => m.active).length} active`}
      actions={<Button onClick={() => setAdding(true)}><Plus size={16} />Add employee</Button>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {loading && <Spinner label="Loading team…" />}

    {!loading && !members.length && (
      <EmptyState icon={UserRound} title="No employees yet"
        description="Add your representatives so route plans can be assigned to them."
        action={<Button onClick={() => setAdding(true)}>Add employee</Button>} />
    )}

    {!loading && members.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {members.map(member => (
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
              <select value={member.role} aria-label={`Role for ${member.name}`}
                onChange={e => patch(member._id, { role: e.target.value }, `${member.name} is now ${ROLE_LABEL[e.target.value as Role]}.`)}
                className="select !min-h-[38px] !py-1 text-xs">
                {ROLES.map(role => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
              </select>
              <button onClick={() => setResetting(member)} aria-label={`Reset password for ${member.name}`}
                className="tap grid place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]"><KeyRound size={16} /></button>
              <Button tone="secondary" className="!min-h-[38px] !px-3 text-xs"
                onClick={() => patch(member._id, { active: !member.active }, `${member.name} ${member.active ? "deactivated" : "reactivated"}.`)}>
                {member.active ? "Deactivate" : "Activate"}
              </Button>
              <button onClick={() => remove(member)} aria-label={`Delete ${member.name}`}
                className="tap grid place-items-center rounded-[10px] text-[var(--danger-ink)] hover:bg-[var(--danger-bg)]"><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </Card>
    )}

    {adding && <AddMember onClose={() => setAdding(false)} onAdded={() => { setAdding(false); setNotice({ tone: "success", text: "Employee added." }); load(); }} />}

    {resetting && (
      <ResetPassword member={resetting} onClose={() => setResetting(null)}
        onDone={() => { setResetting(null); setNotice({ tone: "success", text: `Password reset for ${resetting.name}.` }); }} />
    )}
  </div>;
}

function AddMember({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(data: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/team", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"), employeeId: data.get("employeeId"),
          email: data.get("email"), password: data.get("password"), role: data.get("role"),
          designation: data.get("designation") || undefined,
          department: data.get("department") || undefined,
          joiningDate: data.get("joiningDate") || undefined,
          phone: data.get("phone") || undefined
        })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not add this employee");
      onAdded();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not add this employee");
      setBusy(false);
    }
  }

  return <Modal title="Add employee" description="They sign in with their email or employee ID." onClose={onClose}>
    <form action={submit} className="space-y-4">
      <Field label="Full name"><input name="name" required className="input" /></Field>
      <Field label="Employee ID"><input name="employeeId" required className="input" placeholder="BHX-MR-01" /></Field>
      <Field label="Email"><input name="email" type="email" required className="input" /></Field>
      <Field label="Temporary password" hint="At least 8 characters. Ask them to change it after signing in.">
        <input name="password" type="text" minLength={8} required className="input" />
      </Field>
      {/*
        * The one place somebody could file the wrong kind of person.
        *
        * "Field sales executive" is an employee of this company on the payroll.
        * An outside seller with a coupon code is a **sales partner**, belongs in
        * the Sales CRM, and must never be created here — an affiliate given an
        * employee record would appear in attendance and, worse, in the
        * collection payroll iterates over when it pays salaries.
        */}
      <Field label="Role" hint="Somebody selling on commission with their own coupon code is not an employee — add them under Sales CRM → Partners.">
        <select name="role" defaultValue="MR" className="select">
          {ROLES.map(role => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
        </select>
      </Field>

      {/* Enough of the employment record to be useful on day one; the rest is
          filled in on their profile afterwards. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Designation"><input name="designation" className="input" placeholder="Medical Representative" /></Field>
        <Field label="Department"><input name="department" className="input" placeholder="Field Sales" /></Field>
        <Field label="Joining date"><input name="joiningDate" type="date" className="input" /></Field>
        <Field label="Phone"><input name="phone" className="input" inputMode="tel" /></Field>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" busy={busy} className="w-full">{busy ? "Adding…" : "Add employee"}</Button>
    </form>
  </Modal>;
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
