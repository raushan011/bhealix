"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Briefcase, CalendarCheck, Mail, MapPinned, Pencil, Phone, ShieldCheck, UserRound } from "lucide-react";
import { Badge, Button, Card, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate, todayIso } from "@/lib/time";
import { can, ROLE_LABEL, usesFieldPanel, type Role } from "@/constants/access";
import { LEAVE_TYPES, isCounted, leaveTone, type LeaveBalance, type LeaveStatus, type LeaveType } from "@/lib/hr/leave";
import { EMPLOYMENT_STATUSES, type EmploymentStatus } from "@/lib/hr/payroll";
import { SalaryCard } from "@/components/hr/salary-card";

type Employee = {
  _id: string; name: string; employeeId: string; email: string; role: Role; active: boolean;
  designation?: string; department?: string; joiningDate?: string; employmentType?: string; workLocation?: string;
  employmentStatus?: EmploymentStatus; confirmationDate?: string; exitDate?: string; exitReason?: string;
  reportingTo?: { _id: string; name: string; employeeId: string } | null;
  phone?: string; dateOfBirth?: string; bloodGroup?: string; address?: string;
  emergencyContact?: { name?: string; relation?: string; phone?: string };
  panNumber?: string; aadhaarLastFour?: string; bankAccountNo?: string; bankIfsc?: string;
  bankName?: string; uan?: string; esicNumber?: string;
  leaveEntitlement?: Partial<Record<LeaveType, number>>;
  notes?: string; lastLoginAt?: string; createdAt?: string;
};
type LeaveRow = { _id: string; type: LeaveType; fromDate: string; toDate: string; days: number; status: LeaveStatus; reason: string };
type Payload = { employee: Employee; balances: LeaveBalance[]; leave: LeaveRow[]; completedVisits: number };

/** One person's whole employment record, as the HR desk keeps it. */
export default function EmployeeProfile() {
  const id = String(useParams().id ?? "");
  const [data, setData] = useState<Payload | null>(null);
  const [team, setTeam] = useState<Array<{ _id: string; name: string; employeeId: string }>>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<"employment" | "personal" | "leave" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [detail, staff, me] = await Promise.all([
      fetch(`/api/team/${id}`).then(r => r.json()) as Promise<{ error?: string; data?: Payload }>,
      fetch("/api/team?active=all").then(r => r.json()) as Promise<{ data?: { items: Array<{ _id: string; name: string; employeeId: string }> } }>,
      fetch("/api/auth/me").then(r => r.json()) as Promise<{ data?: { role: Role } }>
    ]);
    if (detail.error || !detail.data) { setError(detail.error ?? "This employee could not be found"); setLoading(false); return; }
    setData(detail.data);
    setTeam((staff.data?.items ?? []).filter(person => person._id !== id));
    setRole(me.data?.role ?? null);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function save(patch: Record<string, unknown>, text: string) {
    const response = await fetch(`/api/team/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch)
    });
    const json = await response.json() as { error?: string };
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not save this" }); return false; }
    setNotice({ tone: "success", text });
    setEditing(null);
    load();
    return true;
  }

  if (loading) return <Spinner label="Loading the record…" />;
  if (error || !data) return <div className="space-y-4">
    <Link href="/admin/team" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />Team
    </Link>
    <Notice tone="error">{error || "This employee could not be found"}</Notice>
  </div>;

  const { employee, balances, leave, completedVisits } = data;
  const mayEdit = role !== null && can.manageEmployees(role);
  const month = todayIso().slice(0, 7);

  return <div className="space-y-5">
    <Link href="/admin/team" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />Team
    </Link>

    <PageTitle title={employee.name}
      subtitle={[employee.designation, employee.department, employee.employeeId].filter(Boolean).join(" · ")}
      actions={<>
        {/* Where they have been and what the doctors said lives on its own
            screen — it is the administrator's to read, not the HR desk's. */}
        {role === "ADMIN" && usesFieldPanel(employee.role) && (
          <Link href={`/admin/team/${id}/activity`}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] bg-white px-4 text-sm font-semibold">
            <MapPinned size={16} />Field activity
          </Link>
        )}
        <Link href={`/admin/hr/attendance?month=${month}`}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] bg-white px-4 text-sm font-semibold">
          <CalendarCheck size={16} />Attendance
        </Link>
        {mayEdit && <Button onClick={() => setEditing("employment")}><Pencil size={16} />Edit record</Button>}
      </>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {!employee.active && <Notice tone="error">This account is deactivated — they cannot sign in.</Notice>}
    {employee.exitDate && (
      <Notice tone="info">
        Last working day {formatDate(employee.exitDate)}
        {employee.exitReason ? ` — ${employee.exitReason}` : ""}. Payroll pays up to that day and no further.
      </Notice>
    )}

    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
      <div className="min-w-0">
        <p className="truncate text-xs text-[var(--muted)]">Role</p>
        <p className="mt-1"><Badge tone={employee.role === "ADMIN" ? "brand" : employee.role === "HR" ? "info" : "neutral"}>
          {ROLE_LABEL[employee.role]}
        </Badge></p>
      </div>
      <Stat label="With the company since" value={employee.joiningDate ? formatDate(employee.joiningDate) : "—"} />
      <Stat label="Visits completed" value={completedVisits} />
      <Stat label="Last signed in" value={employee.lastLoginAt ? formatDate(employee.lastLoginAt) : "Never"} />
    </Card>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Briefcase size={15} className="text-[var(--brand)]" />Employment</h2>
          {mayEdit && <button onClick={() => setEditing("employment")} className="text-xs font-semibold text-[var(--brand)]">Edit</button>}
        </div>
        <dl className="space-y-2 text-sm">
          <Row label="Designation" value={employee.designation} />
          <Row label="Department" value={employee.department} />
          <Row label="Employment type" value={employee.employmentType} />
          <Row label="Work location" value={employee.workLocation} />
          <Row label="Reports to" value={employee.reportingTo ? `${employee.reportingTo.name} (${employee.reportingTo.employeeId})` : undefined} />
          <Row label="Joined" value={employee.joiningDate ? formatDate(employee.joiningDate) : undefined} />
          <Row label="Standing" value={employee.employmentStatus} />
          <Row label="Confirmed" value={employee.confirmationDate ? formatDate(employee.confirmationDate) : undefined} />
          <Row label="Last working day" value={employee.exitDate ? formatDate(employee.exitDate) : undefined} />
        </dl>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><UserRound size={15} className="text-[var(--brand)]" />Personal</h2>
          {mayEdit && <button onClick={() => setEditing("personal")} className="text-xs font-semibold text-[var(--brand)]">Edit</button>}
        </div>
        <dl className="space-y-2 text-sm">
          <Row label="Email" value={employee.email} icon={Mail} />
          <Row label="Phone" value={employee.phone} icon={Phone} />
          <Row label="Date of birth" value={employee.dateOfBirth ? formatDate(employee.dateOfBirth) : undefined} />
          <Row label="Blood group" value={employee.bloodGroup} />
          <Row label="Address" value={employee.address} />
          <Row label="In an emergency" value={[employee.emergencyContact?.name, employee.emergencyContact?.relation, employee.emergencyContact?.phone]
            .filter(Boolean).join(" · ") || undefined} />
        </dl>
      </Card>
    </div>

    {mayEdit && (
      <Card className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={15} className="text-[var(--brand)]" />Statutory and payroll</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label="PAN" value={employee.panNumber} />
          {/* Only the last four digits are ever held — the whole number has no use here. */}
          <Row label="Aadhaar" value={employee.aadhaarLastFour ? `•••• •••• ${employee.aadhaarLastFour}` : undefined} />
          <Row label="UAN" value={employee.uan} />
          <Row label="ESIC number" value={employee.esicNumber} />
          <Row label="Bank" value={employee.bankName} />
          <Row label="Bank account" value={employee.bankAccountNo} />
          <Row label="IFSC" value={employee.bankIfsc} />
        </dl>
      </Card>
    )}

    {/* Salary sits behind the payroll permission rather than the employment one:
        HR keeps the record, but what a colleague earns is not something every
        desk role has business reading. */}
    {role !== null && can.viewPayroll(role) && (
      <SalaryCard employeeId={id} employeeName={employee.name} canEdit={can.runPayroll(role)} />
    )}

    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
        <h2 className="text-sm font-semibold">Leave this year</h2>
        {mayEdit && <button onClick={() => setEditing("leave")} className="text-xs font-semibold text-[var(--brand)]">Set entitlement</button>}
      </div>
      <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-5">
        {balances.map(balance => (
          <div key={balance.type} className="min-w-0">
            <p className="truncate text-xs text-[var(--muted)]">{balance.type}</p>
            <p className="mt-0.5 text-lg font-semibold">
              {isCounted(balance.type) ? balance.available : "—"}
              {isCounted(balance.type) && <span className="text-xs font-normal text-[var(--muted)]">/{balance.entitled}</span>}
            </p>
            <p className="text-[11px] text-[var(--muted)]">
              {balance.taken} taken{balance.pending ? ` · ${balance.pending} pending` : ""}
            </p>
          </div>
        ))}
      </div>

      {leave.length > 0 && (
        <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {leave.map(row => (
            <div key={row._id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {row.type} · {formatDate(row.fromDate)}
                  {row.fromDate !== row.toDate ? ` – ${formatDate(row.toDate)}` : ""}
                  <span className="text-[var(--muted)]"> · {row.days}d</span>
                </p>
                <p className="truncate text-xs text-[var(--muted)]">{row.reason}</p>
              </div>
              <Badge tone={leaveTone(row.status)}>{row.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </Card>

    {employee.notes && <Card className="p-5"><p className="whitespace-pre-line text-sm">{employee.notes}</p></Card>}

    {editing === "employment" && <EmploymentForm employee={employee} team={team}
      onClose={() => setEditing(null)} onSave={patch => save(patch, "Employment record updated.")} />}
    {editing === "personal" && <PersonalForm employee={employee}
      onClose={() => setEditing(null)} onSave={patch => save(patch, "Personal details updated.")} />}
    {editing === "leave" && <EntitlementForm employee={employee} balances={balances}
      onClose={() => setEditing(null)} onSave={patch => save(patch, "Leave entitlement updated.")} />}
  </div>;
}

function Row({ label, value, icon: Icon }: {
  label: string; value?: string; icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return <div className="flex items-start justify-between gap-3">
    <dt className="flex shrink-0 items-center gap-1.5 text-[var(--muted)]">
      {Icon && <Icon size={13} />}{label}
    </dt>
    <dd className="min-w-0 text-right font-medium">{value || <span className="text-[var(--line-2)]">Not recorded</span>}</dd>
  </div>;
}

function EmploymentForm({ employee, team, onClose, onSave }: {
  employee: Employee;
  team: Array<{ _id: string; name: string; employeeId: string }>;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [form, setForm] = useState({
    designation: employee.designation ?? "",
    department: employee.department ?? "",
    employmentType: employee.employmentType ?? "Full time",
    workLocation: employee.workLocation ?? "",
    joiningDate: employee.joiningDate ?? "",
    reportingTo: employee.reportingTo?._id ?? "",
    employmentStatus: employee.employmentStatus ?? "",
    confirmationDate: employee.confirmationDate ?? "",
    exitDate: employee.exitDate ?? "",
    exitReason: employee.exitReason ?? "",
    notes: employee.notes ?? ""
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));

  return <Modal title="Employment record" description={employee.name} onClose={onClose}
    footer={<Button className="w-full" busy={busy} onClick={async () => {
      setBusy(true);
      await onSave({
        ...form,
        reportingTo: form.reportingTo || null,
        // An empty select means "not recorded", which the schema takes as absent
        // rather than as a value of its own.
        employmentStatus: form.employmentStatus || undefined
      });
      setBusy(false);
    }}>{busy ? "Saving…" : "Save"}</Button>}>
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Designation"><input value={form.designation} onChange={e => set({ designation: e.target.value })} className="input" placeholder="Medical Representative" /></Field>
        <Field label="Department"><input value={form.department} onChange={e => set({ department: e.target.value })} className="input" placeholder="Field Sales" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employment type">
          <select value={form.employmentType} onChange={e => set({ employmentType: e.target.value })} className="select">
            {["Full time", "Part time", "Contract", "Intern"].map(value => <option key={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="Work location"><input value={form.workLocation} onChange={e => set({ workLocation: e.target.value })} className="input" placeholder="Bengaluru" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Joining date"><input type="date" value={form.joiningDate} onChange={e => set({ joiningDate: e.target.value })} className="input" /></Field>
        <Field label="Reports to">
          <select value={form.reportingTo} onChange={e => set({ reportingTo: e.target.value })} className="select">
            <option value="">Nobody</option>
            {team.map(person => <option key={person._id} value={person._id}>{person.name} ({person.employeeId})</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Standing" hint="Whether they can sign in is separate — somebody serving notice works every day.">
          <select value={form.employmentStatus} onChange={e => set({ employmentStatus: e.target.value })} className="select">
            <option value="">Not recorded</option>
            {EMPLOYMENT_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
          </select>
        </Field>
        <Field label="Confirmed on">
          <input type="date" value={form.confirmationDate} onChange={e => set({ confirmationDate: e.target.value })} className="input" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Last working day" hint="Payroll pays up to this day, so a mid-month exit settles itself.">
          <input type="date" value={form.exitDate} onChange={e => set({ exitDate: e.target.value })} className="input" />
        </Field>
        <Field label="Reason for leaving">
          <input value={form.exitReason} onChange={e => set({ exitReason: e.target.value })} className="input" placeholder="Resigned" />
        </Field>
      </div>

      <Field label="Notes" hint="Anything the HR desk should remember">
        <textarea value={form.notes} onChange={e => set({ notes: e.target.value })} className="textarea" />
      </Field>
    </div>
  </Modal>;
}

function PersonalForm({ employee, onClose, onSave }: {
  employee: Employee; onClose: () => void; onSave: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [form, setForm] = useState({
    phone: employee.phone ?? "",
    dateOfBirth: employee.dateOfBirth ?? "",
    bloodGroup: employee.bloodGroup ?? "",
    address: employee.address ?? "",
    contactName: employee.emergencyContact?.name ?? "",
    contactRelation: employee.emergencyContact?.relation ?? "",
    contactPhone: employee.emergencyContact?.phone ?? "",
    panNumber: employee.panNumber ?? "",
    aadhaarLastFour: employee.aadhaarLastFour ?? "",
    bankAccountNo: employee.bankAccountNo ?? "",
    bankIfsc: employee.bankIfsc ?? "",
    bankName: employee.bankName ?? "",
    uan: employee.uan ?? "",
    esicNumber: employee.esicNumber ?? ""
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));

  return <Modal title="Personal details" description={employee.name} onClose={onClose}
    footer={<Button className="w-full" busy={busy} onClick={async () => {
      setBusy(true);
      const { contactName, contactRelation, contactPhone, ...rest } = form;
      await onSave({ ...rest, emergencyContact: { name: contactName, relation: contactRelation, phone: contactPhone } });
      setBusy(false);
    }}>{busy ? "Saving…" : "Save"}</Button>}>
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone"><input value={form.phone} onChange={e => set({ phone: e.target.value })} className="input" inputMode="tel" /></Field>
        <Field label="Date of birth"><input type="date" value={form.dateOfBirth} onChange={e => set({ dateOfBirth: e.target.value })} className="input" /></Field>
      </div>
      <Field label="Blood group"><input value={form.bloodGroup} onChange={e => set({ bloodGroup: e.target.value })} className="input" placeholder="O+" /></Field>
      <Field label="Address"><textarea value={form.address} onChange={e => set({ address: e.target.value })} className="textarea" /></Field>

      <p className="text-[13px] font-medium text-[var(--ink-2)]">In an emergency</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name"><input value={form.contactName} onChange={e => set({ contactName: e.target.value })} className="input" /></Field>
        <Field label="Relation"><input value={form.contactRelation} onChange={e => set({ contactRelation: e.target.value })} className="input" /></Field>
        <Field label="Phone"><input value={form.contactPhone} onChange={e => set({ contactPhone: e.target.value })} className="input" inputMode="tel" /></Field>
      </div>

      <p className="text-[13px] font-medium text-[var(--ink-2)]">Statutory and payroll</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="PAN"><input value={form.panNumber} onChange={e => set({ panNumber: e.target.value.toUpperCase() })} className="input" /></Field>
        <Field label="Aadhaar — last four digits" hint="The full number is deliberately not stored">
          <input value={form.aadhaarLastFour} maxLength={4} inputMode="numeric" className="input"
            onChange={e => set({ aadhaarLastFour: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
        </Field>
        <Field label="UAN" hint="The provident fund number, which follows them between employers">
          <input value={form.uan} onChange={e => set({ uan: e.target.value })} className="input" inputMode="numeric" />
        </Field>
        <Field label="ESIC number"><input value={form.esicNumber} onChange={e => set({ esicNumber: e.target.value })} className="input" inputMode="numeric" /></Field>
        <Field label="Bank"><input value={form.bankName} onChange={e => set({ bankName: e.target.value })} className="input" placeholder="State Bank of India" /></Field>
        <Field label="Bank account"><input value={form.bankAccountNo} onChange={e => set({ bankAccountNo: e.target.value })} className="input" /></Field>
        <Field label="IFSC"><input value={form.bankIfsc} onChange={e => set({ bankIfsc: e.target.value.toUpperCase() })} className="input" /></Field>
      </div>
    </div>
  </Modal>;
}

function EntitlementForm({ employee, balances, onClose, onSave }: {
  employee: Employee; balances: LeaveBalance[];
  onClose: () => void; onSave: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [form, setForm] = useState<Record<string, number>>(() =>
    Object.fromEntries(balances.filter(row => isCounted(row.type)).map(row => [row.type, row.entitled])));
  const [busy, setBusy] = useState(false);

  return <Modal title="Leave entitlement" description={`${employee.name} — days allowed each year`} onClose={onClose}
    footer={<Button className="w-full" busy={busy} onClick={async () => {
      setBusy(true);
      await onSave({ leaveEntitlement: form });
      setBusy(false);
    }}>{busy ? "Saving…" : "Save"}</Button>}>
    <div className="space-y-4">
      <Notice tone="info">
        Days already taken and days awaiting approval both come off the figure set here. Unpaid leave is not capped, so
        it is not listed.
      </Notice>
      {LEAVE_TYPES.filter(isCounted).map(type => (
        <Field key={type} label={type}>
          <input type="number" min={0} max={365} value={form[type] ?? 0} className="input"
            onChange={e => setForm(current => ({ ...current, [type]: Math.max(0, Number(e.target.value) || 0) }))} />
        </Field>
      ))}
    </div>
  </Modal>;
}
