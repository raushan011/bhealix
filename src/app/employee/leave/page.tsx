"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarOff, Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate, todayIso } from "@/lib/time";
import {
  HALF_DAY_OPTIONS, LEAVE_TYPES, isCounted, leaveDays, leaveTone,
  type HalfDay, type LeaveBalance, type LeaveStatus, type LeaveType
} from "@/lib/hr/leave";

type Request = {
  _id: string; type: LeaveType; fromDate: string; toDate: string; halfDay?: HalfDay;
  days: number; reason: string; status: LeaveStatus; decisionNote?: string;
  decidedAt?: string; decidedBy?: { name: string } | null;
};

/** The rep's own leave: what is left, what is pending, and how to ask for more. */
export default function MyLeavePage() {
  const [items, setItems] = useState<Request[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/hr/leave?limit=50");
    const json = await response.json() as { data?: { items: Request[]; balances: LeaveBalance[] } };
    setItems(json.data?.items ?? []);
    setBalances(json.data?.balances ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function withdraw(request: Request) {
    if (!window.confirm("Withdraw this request?")) return;
    const response = await fetch(`/api/hr/leave/${request._id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel" })
    });
    const json = await response.json() as { error?: string };
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not withdraw that" }); return; }
    setNotice({ tone: "success", text: "Request withdrawn." });
    load();
  }

  return <div className="space-y-4">
    <PageTitle title="My leave" subtitle="Ask for time off and see where each request stands"
      actions={<Button onClick={() => setApplying(true)}><Plus size={16} />Apply</Button>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {loading && <Spinner label="Loading your leave…" />}

    {!loading && <>
      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        {balances.filter(balance => isCounted(balance.type)).map(balance => (
          <div key={balance.type} className="min-w-0">
            <p className="truncate text-xs text-[var(--muted)]">{balance.type}</p>
            <p className="mt-0.5 text-xl font-semibold">
              {balance.available}<span className="text-xs font-normal text-[var(--muted)]">/{balance.entitled}</span>
            </p>
            {balance.pending > 0 && <p className="text-[11px] text-amber-700">{balance.pending} awaiting approval</p>}
          </div>
        ))}
      </Card>

      {!items.length && (
        <EmptyState icon={CalendarOff} title="No leave requested yet"
          description="Ask for time off here. Your administrator sees it straight away, and approved days show on your attendance."
          action={<Button onClick={() => setApplying(true)}>Apply for leave</Button>} />
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map(request => (
            <Card key={request._id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={leaveTone(request.status)}>{request.status}</Badge>
                <Badge tone="neutral">{request.type}</Badge>
                <span className="text-xs text-[var(--muted)]">{request.days} day{request.days === 1 ? "" : "s"}</span>
              </div>
              <p className="mt-1.5 text-sm font-semibold">
                {formatDate(request.fromDate)}
                {request.fromDate !== request.toDate ? ` – ${formatDate(request.toDate)}` : ""}
                {request.halfDay ? ` · ${request.halfDay}` : ""}
              </p>
              <p className="mt-0.5 text-sm text-[var(--ink-2)]">{request.reason}</p>
              {request.decidedAt && (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {request.status} by {request.decidedBy?.name ?? "the office"} on {formatDate(request.decidedAt)}
                  {request.decisionNote ? ` — ${request.decisionNote}` : ""}
                </p>
              )}
              {request.status === "Pending" && (
                <Button tone="secondary" className="mt-3 w-full !min-h-[38px] text-xs" onClick={() => withdraw(request)}>
                  Withdraw this request
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </>}

    {applying && <ApplyForLeave balances={balances} onClose={() => setApplying(false)}
      onSaved={text => { setApplying(false); setNotice({ tone: "success", text }); load(); }} />}
  </div>;
}

function ApplyForLeave({ balances, onClose, onSaved }: {
  balances: LeaveBalance[]; onClose: () => void; onSaved: (text: string) => void;
}) {
  const [type, setType] = useState<LeaveType>("Casual");
  const [fromDate, setFromDate] = useState(todayIso);
  const [toDate, setToDate] = useState(todayIso);
  const [halfDay, setHalfDay] = useState<HalfDay | "">("");
  const [reason, setReason] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const singleDay = fromDate === toDate;
  const days = leaveDays(fromDate, toDate, singleDay && halfDay ? halfDay : undefined);
  const balance = balances.find(row => row.type === type);
  const short = balance && isCounted(type) && days > balance.available;

  async function submit() {
    if (reason.trim().length < 3) { setError("Say why you need the time off"); return; }
    if (!days) { setError("Check the dates — that range does not cover any days"); return; }

    setBusy(true); setError("");
    try {
      const response = await fetch("/api/hr/leave", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type, fromDate, toDate,
          halfDay: singleDay && halfDay ? halfDay : undefined,
          reason: reason.trim(),
          contactNumber: contactNumber.trim() || undefined
        })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not send that request");
      onSaved(`${days} day${days === 1 ? "" : "s"} of ${type.toLowerCase()} leave requested.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not send that request");
      setBusy(false);
    }
  }

  return <Modal title="Apply for leave" description="Your administrator is asked to approve it." onClose={onClose}
    footer={<Button className="w-full" busy={busy} onClick={submit}>{busy ? "Sending…" : "Send request"}</Button>}>
    <div className="space-y-4">
      <Field label="Type">
        <select value={type} onChange={e => setType(e.target.value as LeaveType)} className="select">
          {LEAVE_TYPES.map(value => {
            const row = balances.find(balance => balance.type === value);
            return <option key={value} value={value}>
              {value}{row && isCounted(value) ? ` — ${row.available} left` : ""}
            </option>;
          })}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input type="date" value={fromDate} className="input"
            onChange={e => {
              setFromDate(e.target.value);
              // Keeping the end date behind the start is never what anybody meant.
              if (toDate < e.target.value) setToDate(e.target.value);
            }} />
        </Field>
        <Field label="To">
          <input type="date" min={fromDate} value={toDate} onChange={e => setToDate(e.target.value)} className="input" />
        </Field>
      </div>

      {singleDay && (
        <Field label="Half a day?" hint="Leave blank for the whole day">
          <select value={halfDay} onChange={e => setHalfDay(e.target.value as HalfDay | "")} className="select">
            <option value="">Full day</option>
            {HALF_DAY_OPTIONS.map(value => <option key={value}>{value}</option>)}
          </select>
        </Field>
      )}

      <p className="rounded-[10px] bg-[var(--surface-2)] px-3 py-2.5 text-sm">
        <strong>{days}</strong> day{days === 1 ? "" : "s"} requested
        {balance && isCounted(type) && <span className="text-[var(--muted)]"> · {balance.available} available</span>}
      </p>

      {short && (
        <Notice tone="error">
          That is more {type.toLowerCase()} leave than you have left. Ask for unpaid leave instead, or shorten the request.
        </Notice>
      )}

      <Field label="Reason"><textarea value={reason} onChange={e => setReason(e.target.value)} className="textarea" /></Field>
      <Field label="Reachable on" hint="Optional — a number for while you are away">
        <input value={contactNumber} onChange={e => setContactNumber(e.target.value)} className="input" inputMode="tel" />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
