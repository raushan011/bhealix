"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ClipboardCheck, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/time";
import { can, ROLE_LABEL, type Role } from "@/constants/access";
import { LEAVE_STATUSES, LEAVE_TYPES, leaveTone, type LeaveStatus, type LeaveType } from "@/lib/hr/leave";

type Request = {
  _id: string; type: LeaveType; fromDate: string; toDate: string; halfDay?: string;
  days: number; reason: string; contactNumber?: string; status: LeaveStatus;
  decidedAt?: string; decisionNote?: string;
  employee?: { _id: string; name: string; employeeId: string; role: Role } | null;
  decidedBy?: { name: string } | null;
};

/**
 * Requests waiting on a decision, and the record of those already decided.
 * Pending comes first because it is the only part that needs anybody to act.
 */
export default function LeavePage() {
  const [items, setItems] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Pending");
  const [type, setType] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [userId, setUserId] = useState("");
  const [deciding, setDeciding] = useState<{ request: Request; action: "approve" | "reject" } | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("status");
    if (wanted && (LEAVE_STATUSES as readonly string[]).includes(wanted)) setStatus(wanted);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (status) params.set("status", status);
    if (type) params.set("type", type);

    const [list, me] = await Promise.all([
      fetch(`/api/hr/leave?${params}`).then(r => r.json()) as Promise<{ data?: { items: Request[] } }>,
      fetch("/api/auth/me").then(r => r.json()) as Promise<{ data?: { _id: string; role: Role } }>
    ]);
    setItems(list.data?.items ?? []);
    setRole(me.data?.role ?? null);
    setUserId(String(me.data?._id ?? ""));
    setLoading(false);
  }, [status, type]);
  useEffect(() => { load(); }, [load]);

  const mayDecide = role !== null && can.manageLeave(role);

  async function decide(request: Request, action: "approve" | "reject", note: string) {
    const response = await fetch(`/api/hr/leave/${request._id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, note: note.trim() || undefined })
    });
    const json = await response.json() as { error?: string };
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not save that decision" }); return; }
    setNotice({
      tone: "success",
      text: `${request.employee?.name ?? "The request"}'s leave was ${action === "approve" ? "approved" : "refused"}.`
    });
    setDeciding(null);
    load();
  }

  return <div className="space-y-5">
    <Link href="/admin/hr" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />People
    </Link>
    <PageTitle title="Leave requests" subtitle="Approved leave marks itself on the attendance sheet" />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <Card className="grid gap-3 p-4 sm:grid-cols-2">
      <select value={status} onChange={e => setStatus(e.target.value)} className="select" aria-label="Filter by status">
        <option value="">Every status</option>
        {LEAVE_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <select value={type} onChange={e => setType(e.target.value)} className="select" aria-label="Filter by type">
        <option value="">Every type</option>
        {LEAVE_TYPES.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </Card>

    {loading && <Spinner label="Loading requests…" />}

    {!loading && !items.length && (
      <EmptyState icon={ClipboardCheck}
        title={status === "Pending" ? "Nothing waiting on you" : "No requests match this"}
        description={status === "Pending"
          ? "Every leave request has been decided."
          : "Try another status or leave type."} />
    )}

    {!loading && items.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {items.map(request => {
          const ownRequest = String(request.employee?._id ?? "") === userId;
          return <div key={request._id} className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">{request.employee?.name ?? "Someone"}</p>
                  <Badge tone={leaveTone(request.status)}>{request.status}</Badge>
                  <Badge tone="neutral">{request.type}</Badge>
                  {request.employee?.role && (
                    <span className="text-xs text-[var(--muted)]">{ROLE_LABEL[request.employee.role]}</span>
                  )}
                </div>
                <p className="mt-1 text-sm">
                  {formatDate(request.fromDate)}
                  {request.fromDate !== request.toDate ? ` – ${formatDate(request.toDate)}` : ""}
                  <span className="text-[var(--muted)]"> · {request.days} day{request.days === 1 ? "" : "s"}</span>
                  {request.halfDay ? <span className="text-[var(--muted)]"> · {request.halfDay}</span> : null}
                </p>
                <p className="mt-1 text-sm text-[var(--ink-2)]">{request.reason}</p>
                {request.contactNumber && (
                  <p className="mt-0.5 text-xs text-[var(--muted)]">Reachable on {request.contactNumber}</p>
                )}
                {request.decidedAt && (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {request.status} by {request.decidedBy?.name ?? "the desk"} on {formatDate(request.decidedAt)}
                    {request.decisionNote ? ` — ${request.decisionNote}` : ""}
                  </p>
                )}
              </div>

              {mayDecide && request.status === "Pending" && (
                <div className="flex shrink-0 gap-2">
                  <Button tone="danger" className="!min-h-[38px] !px-3 text-xs"
                    disabled={ownRequest} onClick={() => setDeciding({ request, action: "reject" })}>
                    <X size={14} />Refuse
                  </Button>
                  <Button className="!min-h-[38px] !px-3 text-xs"
                    disabled={ownRequest} onClick={() => setDeciding({ request, action: "approve" })}>
                    <Check size={14} />Approve
                  </Button>
                </div>
              )}
            </div>

            {/* Signing off your own leave is not a decision anybody should make. */}
            {mayDecide && request.status === "Pending" && ownRequest && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                This is your own request — another administrator has to decide it.
              </p>
            )}
          </div>;
        })}
      </Card>
    )}

    {deciding && <Decide request={deciding.request} action={deciding.action}
      onClose={() => setDeciding(null)}
      onConfirm={note => decide(deciding.request, deciding.action, note)} />}
  </div>;
}

function Decide({ request, action, onClose, onConfirm }: {
  request: Request; action: "approve" | "reject"; onClose: () => void; onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const approving = action === "approve";

  return <Modal
    title={approving ? "Approve this leave" : "Refuse this leave"}
    description={`${request.employee?.name ?? "This employee"} · ${request.days} day${request.days === 1 ? "" : "s"} of ${request.type.toLowerCase()} leave`}
    onClose={onClose}
    footer={<Button tone={approving ? "primary" : "danger"} className="w-full" busy={busy}
      onClick={() => { setBusy(true); onConfirm(note); }}>
      {busy ? "Saving…" : approving ? "Approve" : "Refuse"}
    </Button>}>
    <div className="space-y-4">
      {approving && (
        <Notice tone="info">
          These days will show as leave on the attendance sheet, and come off {request.employee?.name ?? "their"} balance.
        </Notice>
      )}
      <Field label={approving ? "Note (optional)" : "Reason"} hint="The employee sees this on their phone">
        <textarea value={note} onChange={e => setNote(e.target.value)} className="textarea"
          placeholder={approving ? "Cover arranged with the team" : "Two reps already off that week"} />
      </Field>
    </div>
  </Modal>;
}
