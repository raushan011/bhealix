"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Trash2, UserPlus, Users } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { PasswordInput } from "@/components/ui/password-input";
import { ASSIGNABLE_ROLES, ROLE_LABEL, type Role } from "@/constants/access";
import { formatDateTime } from "@/lib/time";

/**
 * Every account, and the four things the super administrator does to one:
 * create it, decide its role, switch it off, remove it.
 *
 * Built on the same `/api/team` routes the Employees screen uses rather than a
 * second set, so the rules — the last administrator cannot be demoted, an
 * account with visits or payslips is deactivated rather than deleted, a super
 * administrator's record is closed to everybody below — hold whichever door
 * somebody comes through. What is different here is who is looking: this
 * screen is the super administrator's, and lists every role at once.
 *
 * A super administrator is still made from a shell and nowhere else — see
 * `ASSIGNABLE_ROLES` for why the account that hands out access cannot be minted
 * from a form.
 */

type Account = {
  _id: string;
  name: string;
  employeeId: string;
  email: string;
  role: Role;
  active: boolean;
  lastLoginAt?: string;
  designation?: string;
  department?: string;
};

const roleTone = (role: Role): "brand" | "info" | "success" | "neutral" =>
  role === "SUPERADMIN" ? "brand" : role === "ADMIN" ? "info" : role === "HR" ? "success" : "neutral";

async function send(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const json = await response.json() as { error?: string; data?: unknown };
  if (!response.ok) throw new Error(json.error ?? "That could not be saved");
  return json.data;
}

export function UserManager({ selfId }: { selfId: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [showInactive, setShowInactive] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch("/api/team?active=all");
    const json = await response.json() as { data?: { items: Account[] }; error?: string };
    if (json.data) setAccounts(json.data.items);
    else setNotice({ tone: "error", text: json.error ?? "Could not read the accounts." });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(work: () => Promise<unknown>, done: string) {
    setNotice(null);
    try {
      await work();
      setNotice({ tone: "success", text: done });
      await load();
    } catch (problem) {
      setNotice({ tone: "error", text: problem instanceof Error ? problem.message : "That could not be done" });
    }
  }

  const toggleActive = (account: Account) => act(
    () => send(`/api/team/${account._id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !account.active }) }),
    account.active ? `${account.name} can no longer sign in.` : `${account.name} can sign in again.`
  );

  const remove = (account: Account) => {
    if (!window.confirm(`Delete ${account.name}'s account for good? If they have visits, stock or payslips on record this will be refused — deactivate instead.`)) return;
    return act(() => send(`/api/team/${account._id}`, { method: "DELETE" }), `${account.name}'s account has been deleted.`);
  };

  if (loading) return <Spinner label="Loading accounts…" />;

  const shown = accounts.filter(account => showInactive || account.active);
  const desk = shown.filter(account => ["SUPERADMIN", "ADMIN", "HR"].includes(account.role));
  const field = shown.filter(account => !["SUPERADMIN", "ADMIN", "HR"].includes(account.role));

  return <div className="space-y-5">
    <PageTitle title="Users" subtitle="Every account: create one, decide its role, switch it off, or remove it"
      actions={<Button onClick={() => setCreating(true)}><UserPlus size={16} />Create user</Button>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <label className="inline-flex items-center gap-2 text-sm text-[var(--ink-2)]">
      <input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} />
      Show deactivated accounts
    </label>

    {[{ title: "Desk accounts", rows: desk, blurb: "Administrators and HR — the people who open the CRMs. Which CRMs each may open is decided under Panel access." },
      { title: "Field accounts", rows: field, blurb: "Medical representatives and field sales executives — the phone panel." }].map(group => (
      <section key={group.title} className="space-y-2">
        <div>
          <h2 className="text-base font-semibold">{group.title}</h2>
          <p className="text-xs text-[var(--muted)]">{group.blurb}</p>
        </div>
        {group.rows.length ? (
          <Card className="divide-y divide-[var(--line)]">
            {group.rows.map(account => {
              const self = account._id === selfId;
              const superAdmin = account.role === "SUPERADMIN";
              return <div key={account._id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{account.name}</p>
                    <Badge tone={roleTone(account.role)}>{ROLE_LABEL[account.role]}</Badge>
                    {self && <Badge>You</Badge>}
                    {!account.active && <Badge tone="danger">Deactivated</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {account.employeeId} · {account.email}
                    {account.designation ? ` · ${account.designation}` : ""}
                    {account.lastLoginAt ? ` · last signed in ${formatDateTime(account.lastLoginAt)}` : " · never signed in"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {superAdmin && !self ? (
                    <span className="text-xs text-[var(--muted)]">Changed from a shell</span>
                  ) : superAdmin && self ? (
                    <Button tone="secondary" className="min-h-[36px] px-3" onClick={() => setEditing(account)}><KeyRound size={14} />Password</Button>
                  ) : <>
                    <Button tone="secondary" className="min-h-[36px] px-3" onClick={() => setEditing(account)}>Edit</Button>
                    <Button tone="secondary" className="min-h-[36px] px-3" onClick={() => toggleActive(account)}>
                      {account.active ? "Deactivate" : "Reactivate"}
                    </Button>
                    <Button tone="danger" className="min-h-[36px] px-3" onClick={() => remove(account)} aria-label={`Delete ${account.name}`}>
                      <Trash2 size={14} />
                    </Button>
                  </>}
                </div>
              </div>;
            })}
          </Card>
        ) : <Card className="p-5 text-sm text-[var(--muted)]">Nobody here.</Card>}
      </section>
    ))}

    {!accounts.length && <EmptyState icon={Users} title="No accounts yet" description="Create the first one." />}

    {creating && <CreateUser onClose={() => setCreating(false)} onDone={name => { setCreating(false); setNotice({ tone: "success", text: `${name} can sign in now.` }); load(); }} />}
    {editing && <EditUser account={editing} self={editing._id === selfId} onClose={() => setEditing(null)}
      onDone={message => { setEditing(null); setNotice({ tone: "success", text: message }); load(); }} />}
  </div>;
}

function CreateUser({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [role, setRole] = useState<Role>("ADMIN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await send("/api/team", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"), employeeId: data.get("employeeId"), email: data.get("email"),
          password: data.get("password"), role,
          designation: data.get("designation") || undefined, phone: data.get("phone") || undefined
        })
      });
      onDone(String(data.get("name")));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not create the account");
    } finally { setBusy(false); }
  }

  return <Modal title="Create a user" description="They can sign in the moment this is saved" onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <Field label="Full name"><input name="name" required minLength={2} className="input" autoFocus /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee ID" hint="What they sign in with, besides their email."><input name="employeeId" required minLength={2} className="input" placeholder="BHX-ADMIN-2" /></Field>
        <Field label="Role">
          <select className="select" value={role} onChange={event => setRole(event.target.value as Role)}>
            {ASSIGNABLE_ROLES.map(value => <option key={value} value={value}>{ROLE_LABEL[value]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Email"><input name="email" type="email" required className="input" placeholder="name@bhealix.com" /></Field>
      <Field label="Password" hint="At least 8 characters. They can change it once signed in."><PasswordInput name="password" required minLength={8} autoComplete="new-password" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Designation"><input name="designation" className="input" /></Field>
        <Field label="Phone"><input name="phone" className="input" /></Field>
      </div>
      {["ADMIN", "HR"].includes(role) && (
        <Notice tone="info">
          A new {ROLE_LABEL[role].toLowerCase()} opens both CRMs by default. Narrow that under <strong>Panel access</strong> if you want them in only one.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button type="button" tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button type="submit" className="flex-1" busy={busy}>Create</Button>
      </div>
    </form>
  </Modal>;
}

/** Name, role and password. The employment record itself lives on the HR screen. */
function EditUser({ account, self, onClose, onDone }: { account: Account; self: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [name, setName] = useState(account.name);
  const [role, setRole] = useState<Role>(account.role);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const superAdmin = account.role === "SUPERADMIN";

  async function save() {
    setBusy(true); setError("");
    try {
      const body: Record<string, unknown> = {};
      if (name.trim() !== account.name) body.name = name.trim();
      if (!superAdmin && role !== account.role) body.role = role;
      if (password) body.newPassword = password;
      if (!Object.keys(body).length) { onClose(); return; }
      await send(`/api/team/${account._id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      onDone(body.role ? `${name.trim()} is now ${ROLE_LABEL[role].toLowerCase()}.` : body.newPassword ? `${name.trim()}'s password has been changed.` : `${name.trim()} has been updated.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save");
    } finally { setBusy(false); }
  }

  return <Modal title={account.name} description={`${account.employeeId} · ${account.email}`} onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" busy={busy} onClick={save}>Save</Button>
    </div>}>
    <div className="space-y-4">
      <Field label="Full name"><input className="input" value={name} onChange={event => setName(event.target.value)} /></Field>
      {!superAdmin && (
        <Field label="Role" hint={self ? "Your own role cannot be changed here." : "Making somebody an administrator gives them billing, the doctor directory, inventory and payouts."}>
          <select className="select" value={role} disabled={self} onChange={event => setRole(event.target.value as Role)}>
            {ASSIGNABLE_ROLES.map(value => <option key={value} value={value}>{ROLE_LABEL[value]}</option>)}
          </select>
        </Field>
      )}
      <Field label="New password" hint="Leave blank to keep the current one. At least 8 characters.">
        <PasswordInput value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={8} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
