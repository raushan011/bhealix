"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, RefreshCw } from "lucide-react";
import { Button, Card, Field, Notice } from "@/components/ui/kit";
import { ASSIGNABLE_ROLES, ROLE_LABEL, type Role } from "@/constants/access";
import { formatMoney as formatInr } from "@/lib/billing/constants";
import { EMPLOYMENT_STATUSES } from "@/lib/hr/payroll";
import { todayIso } from "@/lib/time";

type Person = { _id: string; name: string; employeeId: string };

/** What each role usually starts as, so the common case is two fields rather than six. */
const PRESETS: Partial<Record<Role, { designation: string; department: string }>> = {
  EXECUTIVE: { designation: "Sales Executive", department: "Sales" },
  MR: { designation: "Medical Representative", department: "Field Sales" },
  SALES: { designation: "Field Sales Executive", department: "Field Sales" },
  HR: { designation: "HR Executive", department: "Human Resources" },
  ADMIN: { designation: "Administrator", department: "Management" }
};

/** Where each role signs in, said on the form so nobody has to ask afterwards. */
const PANEL: Partial<Record<Role, string>> = {
  EXECUTIVE: "Signs in to the sales executive panel — their leads, orders and incentives.",
  MR: "Signs in to the field app on their phone — their route, visits and bills.",
  SALES: "Signs in to the field app on their phone — their route, visits and bills.",
  HR: "Signs in at the desk to the panels a super administrator grants them.",
  ADMIN: "Signs in at the desk to the panels a super administrator grants them."
};

function makePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  return `${Array.from(bytes, value => alphabet[value % alphabet.length]).join("")}#7`;
}

const num = (value: FormDataEntryValue | null) => Math.max(0, Number(value) || 0);
const str = (value: FormDataEntryValue | null) => String(value ?? "").trim() || undefined;

/**
 * Hiring somebody, in one form: their login, their whole employment record and
 * their first salary.
 *
 * Every employee is added here whichever CRM they will work in — a sales
 * executive, a medical representative, the HR desk. Only the login is required;
 * the rest can be filled in later from their profile, and the salary from the
 * Salary card there.
 */
export function EmployeeOnboarding({ initialRole, mayAssignRoles, mayRunPayroll }: {
  initialRole: Role; mayAssignRoles: boolean; mayRunPayroll: boolean;
}) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(initialRole);
  const [password, setPassword] = useState(makePassword);
  const [designation, setDesignation] = useState(PRESETS[initialRole]?.designation ?? "");
  const [department, setDepartment] = useState(PRESETS[initialRole]?.department ?? "");
  const [joining, setJoining] = useState(todayIso());
  const [people, setPeople] = useState<Person[]>([]);
  const [withSalary, setWithSalary] = useState(mayRunPayroll);
  const [pay, setPay] = useState({ basic: 0, hra: 0, conveyance: 0, medical: 0, special: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/team").then(response => response.json())
      .then((json: { data?: { items: Person[] } }) => setPeople(json.data?.items ?? []))
      .catch(() => setPeople([]));
  }, []);

  const roles = ASSIGNABLE_ROLES.filter(value => mayAssignRoles || !["ADMIN", "HR"].includes(value));
  const gross = useMemo(() => Object.values(pay).reduce((sum, value) => sum + value, 0), [pay]);

  function chooseRole(next: Role) {
    // Only replace what still holds the previous role's suggestion — never something typed.
    const before = PRESETS[role];
    if (!designation || designation === before?.designation) setDesignation(PRESETS[next]?.designation ?? "");
    if (!department || department === before?.department) setDepartment(PRESETS[next]?.department ?? "");
    setRole(next);
  }

  async function submit(data: FormData) {
    setBusy(true); setError("");
    const body = {
      name: str(data.get("name")), employeeId: str(data.get("employeeId")), email: str(data.get("email")), password, role,
      designation: designation || undefined, department: department || undefined,
      joiningDate: joining || undefined,
      employmentType: str(data.get("employmentType")),
      employmentStatus: str(data.get("employmentStatus")),
      workLocation: str(data.get("workLocation")),
      reportingTo: str(data.get("reportingTo")) ?? null,
      phone: str(data.get("phone")), dateOfBirth: str(data.get("dateOfBirth")), bloodGroup: str(data.get("bloodGroup")),
      address: str(data.get("address")),
      emergencyContact: { name: str(data.get("ecName")), relation: str(data.get("ecRelation")), phone: str(data.get("ecPhone")) },
      panNumber: str(data.get("panNumber"))?.toUpperCase(), aadhaarLastFour: str(data.get("aadhaarLastFour")),
      uan: str(data.get("uan")), esicNumber: str(data.get("esicNumber")),
      bankName: str(data.get("bankName")), bankAccountNo: str(data.get("bankAccountNo")), bankIfsc: str(data.get("bankIfsc"))?.toUpperCase(),
      salary: withSalary && pay.basic > 0 ? {
        effectiveFrom: String(data.get("effectiveFrom") || (joining || todayIso()).slice(0, 7)),
        ...pay,
        pfApplicable: data.get("pfApplicable") === "on",
        esiApplicable: data.get("esiApplicable") === "on",
        professionalTaxApplicable: data.get("ptApplicable") === "on",
        monthlyTds: num(data.get("monthlyTds"))
      } : undefined
    };
    try {
      const response = await fetch("/api/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json() as { data?: { _id: string }; error?: string };
      if (!response.ok || !json.data) throw new Error(json.error ?? "Could not add this employee");
      router.push(`/admin/team/${json.data._id}?created=1`);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not add this employee");
      setBusy(false);
    }
  }

  return <form action={submit} className="grid gap-5 lg:grid-cols-[1fr_300px] lg:items-start">
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><KeyRound size={16} />Login</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name"><input name="name" required minLength={2} className="input" /></Field>
          <Field label="Role">
            <select className="select" value={role} onChange={event => chooseRole(event.target.value as Role)}>
              {roles.map(value => <option key={value} value={value}>{ROLE_LABEL[value]}</option>)}
            </select>
          </Field>
          <Field label="Email" hint="They sign in with this or their employee ID."><input name="email" type="email" required className="input" /></Field>
          <Field label="Employee ID"><input name="employeeId" required minLength={2} className="input" placeholder={role === "EXECUTIVE" ? "BHX-SE-01" : "BHX-MR-01"} /></Field>
        </div>
        <Field label="Temporary password" hint="Share it with them directly. They can change it from their profile after signing in.">
          <div className="flex gap-2">
            <input className="input font-mono" value={password} minLength={8} required onChange={event => setPassword(event.target.value)} />
            <Button type="button" tone="secondary" onClick={() => setPassword(makePassword())} aria-label="Generate another"><RefreshCw size={15} /></Button>
          </div>
        </Field>
        {PANEL[role] && <Notice>{PANEL[role]}</Notice>}
        {role === "SALES" && <p className="text-xs text-[var(--muted)]">A field sales executive works a round of clinics in the Doctor CRM. For somebody who works leads and places orders, choose <strong>Sales executive</strong>. An outside seller with a coupon code is not an employee — add them under Affiliate CRM → Partners.</p>}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold">Employment</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Designation"><input className="input" value={designation} onChange={event => setDesignation(event.target.value)} /></Field>
          <Field label="Department"><input className="input" value={department} onChange={event => setDepartment(event.target.value)} /></Field>
          <Field label="Joining date"><input type="date" className="input" value={joining} onChange={event => setJoining(event.target.value)} /></Field>
          <Field label="Employment type">
            <select name="employmentType" className="select" defaultValue="Full time">
              {["Full time", "Part time", "Contract", "Intern"].map(value => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select name="employmentStatus" className="select" defaultValue="Probation">
              {EMPLOYMENT_STATUSES.filter(value => value !== "Exited").map(value => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <Field label="Reports to">
            <select name="reportingTo" className="select" defaultValue="">
              <option value="">Nobody yet</option>
              {people.map(person => <option key={person._id} value={person._id}>{person.name} · {person.employeeId}</option>)}
            </select>
          </Field>
          <Field label="Work location"><input name="workLocation" className="input" placeholder="Bengaluru office" /></Field>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold">Personal</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Phone"><input name="phone" className="input" inputMode="tel" /></Field>
          <Field label="Date of birth"><input name="dateOfBirth" type="date" className="input" /></Field>
          <Field label="Blood group"><input name="bloodGroup" className="input" maxLength={10} placeholder="B+" /></Field>
        </div>
        <Field label="Address"><textarea name="address" className="textarea" rows={2} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Emergency contact"><input name="ecName" className="input" /></Field>
          <Field label="Relation"><input name="ecRelation" className="input" /></Field>
          <Field label="Their phone"><input name="ecPhone" className="input" inputMode="tel" /></Field>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold">Bank and statutory</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="PAN"><input name="panNumber" className="input uppercase" maxLength={10} /></Field>
          <Field label="Aadhaar — last four digits only" hint="The full number is never stored."><input name="aadhaarLastFour" className="input" inputMode="numeric" maxLength={4} pattern="\d{4}" /></Field>
          <Field label="UAN (provident fund)"><input name="uan" className="input" /></Field>
          <Field label="ESIC number"><input name="esicNumber" className="input" /></Field>
          <Field label="Bank"><input name="bankName" className="input" /></Field>
          <Field label="Account number"><input name="bankAccountNo" className="input" inputMode="numeric" /></Field>
          <Field label="IFSC"><input name="bankIfsc" className="input uppercase" maxLength={11} /></Field>
        </div>
      </Card>

      {mayRunPayroll && <Card className="space-y-4 p-5">
        <label className="flex items-center gap-2 text-[15px] font-semibold">
          <input type="checkbox" checked={withSalary} onChange={event => setWithSalary(event.target.checked)} />Set their salary now
        </label>
        {withSalary && <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="From month"><input name="effectiveFrom" type="month" className="input" defaultValue={(joining || todayIso()).slice(0, 7)} key={joining.slice(0, 7)} /></Field>
            {(["basic", "hra", "conveyance", "medical", "special"] as const).map(key => (
              <Field key={key} label={{ basic: "Basic", hra: "HRA", conveyance: "Conveyance", medical: "Medical", special: "Special allowance" }[key]}>
                <input className="input" type="number" min={0} value={pay[key] || ""} placeholder="0" onChange={event => setPay({ ...pay, [key]: Math.max(0, Number(event.target.value) || 0) })} />
              </Field>
            ))}
            <Field label="Monthly TDS"><input name="monthlyTds" className="input" type="number" min={0} placeholder="0" /></Field>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="pfApplicable" defaultChecked />Provident fund</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="esiApplicable" defaultChecked />ESI (where the wage qualifies)</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="ptApplicable" defaultChecked />Professional tax</label>
          </div>
          <p className="text-xs text-[var(--muted)]">Monthly figures. Deductions are worked out by payroll from the company&rsquo;s settings. Allowances of your own, recoveries and later raises are added from the Salary card on their profile.</p>
        </>}
      </Card>}
    </div>

    <Card className="space-y-3 p-5 lg:sticky lg:top-6">
      <h2 className="text-[15px] font-semibold">Summary</h2>
      <p className="text-sm"><span className="text-[var(--muted)]">Role</span><br />{ROLE_LABEL[role]}</p>
      <p className="text-sm"><span className="text-[var(--muted)]">Joining</span><br />{joining || "Not set"}</p>
      {mayRunPayroll && <p className="text-sm"><span className="text-[var(--muted)]">Monthly gross</span><br /><span className="text-lg font-semibold">{withSalary && pay.basic ? formatInr(gross) : "Not set"}</span>{withSalary && pay.basic ? <span className="block text-xs text-[var(--muted)]">{formatInr(gross * 12)} a year</span> : null}</p>}
      {withSalary && pay.basic === 0 && <p className="text-xs text-[var(--warn-ink)]">Enter a basic to save a salary, or untick it to add one later.</p>}
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" busy={busy} className="w-full">Add employee</Button>
    </Card>
  </form>;
}
