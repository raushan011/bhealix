"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, MapPin, Navigation, Package, Pencil, Phone, Plus, X } from "lucide-react";
import { doctorMapsUrl } from "@/lib/doctors/maps";
import { Badge, Button, Card, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { CallScheduleEditor, type EditableWindow } from "@/components/doctors/call-schedule-editor";
import { DoctorPicker, placeOf, type PickableDoctor } from "@/components/doctors/doctor-picker";
import { VisitPhotos, type VisitPhoto } from "@/components/visits/visit-photos";
import { summariseCallSchedule } from "@/lib/doctors/call-schedule";
import { requestFix } from "@/lib/geo-fix";
import { toDisplayTime, todayIso } from "@/lib/time";
import { INTEREST_LEVELS, VISIT_OUTCOMES } from "@/lib/visits";

type VisitState = {
  _id: string; status: string; plannedStart?: string; outcome?: string; interest?: string;
  notes: string; orderValue?: number; productsDiscussed: string[];
  samples: Array<{ product: string; quantity: number }>; followUpDate?: string;
};
type DoctorState = {
  _id: string; name: string; clinicName?: string; area?: string; city?: string;
  fullAddress?: string; phone?: string; coordinates?: number[]; callSchedule: EditableWindow[];
};

export function VisitForm({ visit, doctor, products, stock = {}, photos = [] }:
  { visit: VisitState; doctor: DoctorState; products: string[]; stock?: Record<string, number>; photos?: VisitPhoto[] }) {
  const router = useRouter();
  const [status, setStatus] = useState(visit.status);
  const [outcome, setOutcome] = useState(visit.outcome ?? "");
  const [interest, setInterest] = useState(visit.interest ?? "");
  const [discussed, setDiscussed] = useState<string[]>(visit.productsDiscussed);
  const [samples, setSamples] = useState(visit.samples);
  const [orderValue, setOrderValue] = useState(visit.orderValue?.toString() ?? "");
  const [notes, setNotes] = useState(visit.notes);
  const [followUp, setFollowUp] = useState(visit.followUpDate ?? "");
  const [callSchedule, setCallSchedule] = useState(doctor.callSchedule);
  const [editingCallTime, setEditingCallTime] = useState(false);
  /**
   * The doctor the visit is recorded against, when the rep has changed it. Sent
   * with the save rather than on its own, so a wrong pick can be undone before
   * anything is written; `null` means the doctor the visit was opened with.
   */
  const [chosenDoctor, setChosenDoctor] = useState<PickableDoctor | null>(null);
  const [pickingDoctor, setPickingDoctor] = useState(false);
  /** A closed visit being corrected. The form is the same one that completed it. */
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locationNote, setLocationNote] = useState("");

  const completed = status === "Completed" || status === "Missed";
  const shownDoctor = chosenDoctor
    ? { ...chosenDoctor, phone: chosenDoctor.phones?.[0], coordinates: chosenDoctor.location?.coordinates }
    : doctor;
  const doctorChanged = chosenDoctor !== null && chosenDoctor._id !== doctor._id;

  async function send(body: Record<string, unknown>) {
    const response = await fetch(`/api/visits/${visit._id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    const json = await response.json() as { error?: string };
    if (!response.ok) throw new Error(json.error ?? "Could not save");
    return json;
  }

  /**
   * Arriving at the clinic.
   *
   * The position is asked for through the shared helper, which waits long
   * enough for the permission prompt to be read and falls back to the network
   * when GPS cannot see the sky. A short high-accuracy request instead records
   * most check-ins with no location at all — indoors it is the ordinary
   * outcome, not the exception — and a check-in that cannot say where it
   * happened is most of the point of having one.
   */
  async function checkIn() {
    setBusy(true); setError("");
    try {
      const { fix } = await requestFix();
      await send({ action: "check-in", ...(fix ?? {}) });
      setStatus("In progress");
      setLocationNote(fix ? "Location recorded at check-in." : "Checked in without location.");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not check in");
    } finally { setBusy(false); }
  }

  /** The details as the form holds them — what completing and correcting both send. */
  const details = () => ({
    outcome,
    productsDiscussed: discussed,
    samples: samples.filter(sample => sample.product && sample.quantity > 0),
    interest: interest || undefined,
    orderValue: orderValue ? Number(orderValue) : undefined,
    notes,
    followUpDate: followUp || undefined,
    ...(doctorChanged && chosenDoctor ? { doctor: chosenDoctor._id } : {})
  });

  async function complete() {
    if (!outcome) { setError("Choose what happened at this visit"); return; }
    setBusy(true); setError("");
    try {
      await send({ action: "complete", ...details() });
      setStatus("Completed");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save this visit");
    } finally { setBusy(false); }
  }

  /**
   * Saves a correction to a visit already closed. The visit ends up Completed
   * whatever it was before — a Missed visit corrected with an outcome is one
   * that happened after all.
   */
  async function saveEdit() {
    if (!outcome) { setError("Choose what happened at this visit"); return; }
    setBusy(true); setError(""); setSaved("");
    try {
      await send({ action: "edit", ...details() });
      setStatus("Completed");
      setEditing(false);
      setSaved("Your changes were saved.");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save your changes");
    } finally { setBusy(false); }
  }

  async function markMissed() {
    if (!window.confirm("Mark this visit as missed?")) return;
    setBusy(true); setError("");
    try {
      await send({ action: "missed", notes });
      setStatus("Missed");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not update this visit");
    } finally { setBusy(false); }
  }

  const toggleProduct = (product: string) =>
    setDiscussed(current => current.includes(product) ? current.filter(item => item !== product) : [...current, product]);

  const addSample = () => setSamples(current => [...current, { product: products[0] ?? "", quantity: 1 }]);
  const updateSample = (index: number, patch: Partial<{ product: string; quantity: number }>) =>
    setSamples(current => current.map((sample, i) => i === index ? { ...sample, ...patch } : sample));
  const removeSample = (index: number) => setSamples(current => current.filter((_, i) => i !== index));

  return <div className="space-y-4">
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{shownDoctor.name}</h1>
          <p className="mt-0.5 truncate text-sm text-[var(--muted)]">{[shownDoctor.clinicName, shownDoctor.area, shownDoctor.city].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        <Badge tone={status === "Completed" ? "success" : status === "Missed" ? "danger" : status === "In progress" ? "info" : "neutral"}>{status}</Badge>
      </div>

      {visit.plannedStart && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
          <Clock size={14} />Planned for {toDisplayTime(visit.plannedStart)}
        </p>
      )}
      {shownDoctor.fullAddress && (
        <p className="mt-1.5 flex items-start gap-1.5 text-sm text-[var(--ink-2)]">
          <MapPin size={14} className="mt-0.5 shrink-0 text-[var(--muted)]" />{shownDoctor.fullAddress}
        </p>
      )}

      {/* The doctor can be corrected once the rep is at the clinic — the wrong
          name picked from a list of similar ones, or the practice next door.
          It is written with the save, so it can still be undone until then. */}
      {status !== "Planned" && (!completed || editing) && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-[10px] bg-[var(--surface-2)] px-3 py-2">
          <p className="min-w-0 text-xs text-[var(--muted)]">
            {doctorChanged
              ? <>Changed from <span className="font-semibold text-[var(--ink-2)]">{doctor.name}</span> — saved with the visit.</>
              : "Not the doctor you saw?"}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {doctorChanged && <button type="button" onClick={() => setChosenDoctor(null)} className="text-xs font-semibold text-[var(--muted)] underline">Undo</button>}
            <button type="button" onClick={() => setPickingDoctor(true)} className="text-xs font-semibold text-[var(--brand)]">Change doctor</button>
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        {shownDoctor.phone && <a href={`tel:${shownDoctor.phone}`} className="tap flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] text-sm font-semibold"><Phone size={15} />Call</a>}
        {(() => {
          // Pin when there is one, an address search when there is not — see
          // lib/doctors/maps for the fallback order.
          const maps = doctorMapsUrl({
            coordinates: shownDoctor.coordinates,
            name: shownDoctor.name, clinicName: shownDoctor.clinicName,
            fullAddress: shownDoctor.fullAddress, area: shownDoctor.area, city: shownDoctor.city
          });
          return maps && (
            <a href={maps}
              target="_blank" rel="noreferrer" className="tap flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] text-sm font-semibold">
              <Navigation size={15} />Directions
            </a>
          );
        })()}
      </div>
    </Card>

    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold"><Clock size={14} className="text-[var(--brand)]" />MR call time</p>
          <p className="mt-1 text-sm text-[var(--ink-2)]">{summariseCallSchedule(callSchedule)}</p>
        </div>
        <Button tone="secondary" className="!min-h-9 !px-3 text-xs" onClick={() => setEditingCallTime(true)}>Correct</Button>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        If the doctor told you a different timing, update it here — future route plans use it.
      </p>
    </Card>

    {status === "Planned" && (
      <Button onClick={checkIn} busy={busy} className="w-full"><MapPin size={16} />Check in at clinic</Button>
    )}
    {locationNote && <Notice tone="success">{locationNote}</Notice>}

    {/* Photos stay available after the visit is closed: a rep who completed the
        call and then remembered the photo should not have to reopen anything.
        Before check-in there is nothing to photograph, so the card is hidden. */}
    {status !== "Planned" && <VisitPhotos visitId={visit._id} initial={photos} canAdd />}

    {saved && !editing && <Notice tone="success">{saved}</Notice>}

    {((!completed && status !== "Planned") || editing) && <>
      <Card className="space-y-4 p-4">
        <h2 className="text-[15px] font-semibold">{editing ? "Correct what happened" : "What happened?"}</h2>

        <div>
          <p className="mb-2 text-[13px] font-medium text-[var(--ink-2)]">Outcome</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {VISIT_OUTCOMES.map(option => (
              <button key={option} type="button" onClick={() => setOutcome(option)}
                className={`min-h-[44px] rounded-[10px] border px-3 text-left text-sm font-medium ${
                  outcome === option ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]" : "border-[var(--line-2)] bg-[var(--surface)]"
                }`}>{option}</button>
            ))}
          </div>
        </div>

        {products.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-medium text-[var(--ink-2)]">Products discussed</p>
            <div className="flex flex-wrap gap-1.5">
              {products.map(product => (
                <button key={product} type="button" onClick={() => toggleProduct(product)}
                  className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold ${
                    discussed.includes(product) ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]"
                  }`}>{product}</button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink-2)]"><Package size={14} />Samples given</p>
            <button type="button" onClick={addSample} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]"><Plus size={13} />Add</button>
          </div>
          {samples.length ? (
            <div className="space-y-2">
              {samples.map((sample, index) => {
                const inHand = stock[sample.product];
                return <div key={index}>
                  <div className="flex items-center gap-2">
                    <select value={sample.product} onChange={e => updateSample(index, { product: e.target.value })} className="select flex-1">
                      {products.length ? products.map(product => <option key={product}>{product}</option>) : <option value="">No products configured</option>}
                    </select>
                    <input type="number" min={1} max={999} value={sample.quantity}
                      onChange={e => updateSample(index, { quantity: Number(e.target.value) || 1 })}
                      aria-label="Quantity" className="input w-20 shrink-0" />
                    <button type="button" onClick={() => removeSample(index)} aria-label="Remove sample"
                      className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--danger-ink)]"><X size={16} /></button>
                  </div>
                  {/* A count that is behind reality must not stop a rep mid-clinic, so this warns and lets them carry on. */}
                  {inHand !== undefined && (
                    <p className={`mt-1 text-xs ${sample.quantity > inHand ? "font-semibold text-[var(--warn-ink)]" : "text-[var(--muted)]"}`}>
                      {sample.quantity > inHand
                        ? `You are recording more than the ${inHand} shown in hand — save it anyway and tell your administrator.`
                        : `${inHand} in hand`}
                    </p>
                  )}
                </div>;
              })}
            </div>
          ) : <p className="text-sm text-[var(--muted)]">None recorded.</p>}
        </div>

        <div>
          <p className="mb-2 text-[13px] font-medium text-[var(--ink-2)]">Doctor&apos;s interest</p>
          <div className="flex flex-wrap gap-1.5">
            {INTEREST_LEVELS.map(level => (
              <button key={level} type="button" onClick={() => setInterest(interest === level ? "" : level)}
                className={`min-h-[38px] rounded-full border px-3.5 text-xs font-semibold ${
                  interest === level ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]"
                }`}>{level}</button>
            ))}
          </div>
        </div>

        <Field label="Order value (optional)">
          <input type="number" min={0} value={orderValue} onChange={e => setOrderValue(e.target.value)} className="input" placeholder="₹" />
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="textarea" placeholder="What the doctor said, next steps…" />
        </Field>
        <Field label="Follow-up date (optional)">
          <input type="date" min={todayIso()} value={followUp} onChange={e => setFollowUp(e.target.value)} className="input" />
        </Field>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}

      {editing ? (
        <div className="flex gap-2">
          <Button onClick={saveEdit} busy={busy} className="flex-1"><Check size={16} />Save changes</Button>
          <Button tone="secondary" onClick={() => { setEditing(false); setChosenDoctor(null); setError(""); }} disabled={busy}>Cancel</Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button onClick={complete} busy={busy} className="flex-1"><Check size={16} />Complete visit</Button>
          <Button tone="danger" onClick={markMissed} disabled={busy}>Missed</Button>
        </div>
      )}
    </>}

    {completed && !editing && (
      <Card className="p-6 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--ok-bg)] text-[var(--ok-ink)]"><Check size={24} /></span>
        <p className="mt-3 font-semibold">Visit {status.toLowerCase()}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">Your administrator can see this in the visit report.</p>
        {status === "Completed" && (
          <dl className="mx-auto mt-3 max-w-sm space-y-1 text-left text-sm">
            {outcome && <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Outcome</dt><dd className="font-medium">{outcome}</dd></div>}
            {interest && <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Interest</dt><dd className="font-medium">{interest}</dd></div>}
            {discussed.length > 0 && <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Discussed</dt><dd className="text-right font-medium">{discussed.join(", ")}</dd></div>}
            {samples.length > 0 && <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Samples</dt><dd className="text-right font-medium">{samples.map(sample => `${sample.product} × ${sample.quantity}`).join(", ")}</dd></div>}
            {orderValue && <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Order</dt><dd className="font-medium">₹{Number(orderValue).toLocaleString("en-IN")}</dd></div>}
            {followUp && <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Follow-up</dt><dd className="font-medium">{followUp}</dd></div>}
            {notes && <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Notes</dt><dd className="text-right font-medium">{notes}</dd></div>}
          </dl>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <Button tone="secondary" onClick={() => router.push("/employee")}>Back to today</Button>
          {/* A rep who ticked the wrong outcome, left off a sample or wants to
              add to the note can put it right themselves; the photos above
              can be retaken at any time. */}
          <Button onClick={() => { setEditing(true); setSaved(""); setError(""); }}><Pencil size={15} />Edit visit</Button>
        </div>
      </Card>
    )}

    {pickingDoctor && (
      <Modal title="Change the doctor" description="Who did you actually see?" onClose={() => setPickingDoctor(false)}>
        <div className="space-y-3">
          <DoctorPicker requireLocation={false} placeholder="Search by name, clinic or area"
            onSelect={picked => { setChosenDoctor(picked._id === doctor._id ? null : picked); setPickingDoctor(false); }} />
          <p className="text-xs text-[var(--muted)]">
            Currently recorded against <span className="font-semibold">{doctor.name}</span> · {placeOf(doctor)}.
            The photos and samples on this visit move with it.
          </p>
        </div>
      </Modal>
    )}

    {editingCallTime && (
      <Modal title="Correct the call time" description={doctor.name} onClose={() => setEditingCallTime(false)}>
        <CallScheduleEditor doctorId={doctor._id} doctorName={doctor.name} initial={callSchedule}
          onCancel={() => setEditingCallTime(false)}
          onSaved={next => { setCallSchedule(next); setEditingCallTime(false); }} />
      </Modal>
    )}
  </div>;
}
