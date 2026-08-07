"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Plus, Stethoscope, UserPlus } from "lucide-react";
import { Button, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { DoctorPicker, placeOf, type PickableDoctor } from "@/components/doctors/doctor-picker";
import { completeFix, type Fix } from "@/lib/geo";

/** Long enough for a cold start in a doorway, short enough not to strand the rep. */
const FIX_TIMEOUT_MS = 10_000;

/** The rep's own position, or null. A missing one never blocks the call itself. */
function currentFix(): Promise<Fix | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => resolve(completeFix(position.coords) ?? null),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge: 30_000 }
    );
  });
}

/**
 * Recording a call the day's plan did not contain.
 *
 * A route plan is what somebody worked out the evening before; a day in the
 * field is not that. A rep passes a clinic, is called in by a doctor they met
 * last week, or walks into a practice nobody has entered yet. Without this the
 * call either went unrecorded — and the day's work looked thinner than it was —
 * or it was written into whatever planned visit was nearest, which is worse.
 *
 * The doctor's location is not required to pick them here, unlike route
 * planning: a doctor added by hand from a corridor may have no coordinate yet,
 * and refusing to record the call because of that would punish the rep for the
 * gap the visit is about to close.
 */
export function RegisterVisit({ doctor }: {
  /** Pre-chosen, when the rep is already looking at the doctor they walked in on. */
  doctor?: PickableDoctor;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return <>
    <button onClick={() => setOpen(true)}
      className="card tap flex w-full items-center gap-3 p-3.5 text-left active:bg-[var(--surface-2)]">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
        <Plus size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Register a visit</span>
        <span className="block text-xs text-[var(--muted)]">
          {doctor ? `Record a call on ${doctor.name} right now` : "A doctor you saw without a plan, or a new one"}
        </span>
      </span>
    </button>

    {open && <RegisterSheet chosen={doctor} onClose={() => setOpen(false)}
      onDone={id => { setOpen(false); router.push(`/employee/visits/${id}`); }} />}
  </>;
}

function RegisterSheet({ chosen, onClose, onDone }: {
  chosen?: PickableDoctor; onClose: () => void; onDone: (id: string) => void;
}) {
  const [doctor, setDoctor] = useState<PickableDoctor | null>(chosen ?? null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");

  async function start() {
    if (!doctor) { setError("Choose the doctor you are visiting"); return; }
    setBusy(true); setError(""); setStage("Finding your location…");
    try {
      // Taken here rather than on the visit screen: the rep is standing at the
      // clinic now, and this is the moment the arrival is worth recording.
      const fix = await currentFix();
      setStage("Starting the visit…");
      const response = await fetch("/api/visits", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ doctor: doctor._id, notes, ...(fix ?? {}) })
      });
      const json = await response.json() as { error?: string; data?: { _id: string } };
      if (!response.ok || !json.data) throw new Error(json.error ?? "Could not register this visit");
      onDone(String(json.data._id));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not register this visit");
      setBusy(false); setStage("");
    }
  }

  return <Modal title="Register a visit" description="Checked in as soon as you start it" onClose={onClose}
    footer={<Button className="w-full" busy={busy} disabled={!doctor} onClick={start}>
      {busy ? stage || "Starting…" : "Start this visit"}
    </Button>}>
    <div className="space-y-4">
      {doctor ? (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-[var(--brand)] bg-[var(--brand-soft)] p-3">
          <MapPin size={15} className="mt-0.5 shrink-0 text-[var(--brand)]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{doctor.name}</p>
            <p className="truncate text-xs text-[var(--muted)]">{placeOf(doctor)}</p>
          </div>
          <button onClick={() => setDoctor(null)} className="shrink-0 text-xs font-semibold text-[var(--brand)]">
            Change
          </button>
        </div>
      ) : (
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-[var(--ink-2)]">Which doctor?</p>
          <DoctorPicker requireLocation={false} onSelect={setDoctor}
            placeholder="Search by name, clinic or area" />
        </div>
      )}

      {/* The clinic nobody has entered yet is half of why this screen exists,
          so the way to add one is on it rather than two menus away. */}
      {!doctor && (
        <Link href="/employee/doctors/new"
          className="flex items-center gap-2 rounded-[10px] border border-dashed border-[var(--line-2)] p-3 text-sm font-semibold text-[var(--brand)]">
          <UserPlus size={15} />Not in the list? Add the doctor first
        </Link>
      )}

      <div>
        <p className="mb-1.5 text-[13px] font-medium text-[var(--ink-2)]">Why this call (optional)</p>
        <textarea value={notes} onChange={event => setNotes(event.target.value)} className="textarea"
          placeholder="Passing the clinic, doctor asked me to come in…" />
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <p className="flex items-start gap-1.5 text-xs text-[var(--muted)]">
        <Stethoscope size={13} className="mt-0.5 shrink-0" />
        It appears in today&apos;s work like any other visit, marked as unplanned. Record the outcome and the photos on
        the visit screen.
      </p>
    </div>
  </Modal>;
}
