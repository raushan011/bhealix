"use client";

import { useState } from "react";
import { Clock, Pencil } from "lucide-react";
import { Button, Card, Notice } from "@/components/ui/kit";
import { CallScheduleEditor, type EditableWindow } from "./call-schedule-editor";
import { summariseCallSchedule } from "@/lib/doctors/call-schedule";

export function DoctorCallTimeCard({ doctorId, doctorName, initial }: {
  doctorId: string; doctorName: string; initial: EditableWindow[];
}) {
  const [windows, setWindows] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  return <Card className="p-5">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        <Clock size={17} className="text-[var(--brand)]" />
        <h2 className="text-[15px] font-semibold">MR call time</h2>
      </div>
      {!editing && <Button tone="ghost" onClick={() => { setEditing(true); setSaved(false); }} className="!min-h-9 !px-2"><Pencil size={14} />Edit</Button>}
    </div>

    {editing ? (
      <div className="mt-4">
        <CallScheduleEditor
          doctorId={doctorId} doctorName={doctorName} initial={windows}
          onCancel={() => setEditing(false)}
          onSaved={next => { setWindows(next); setEditing(false); setSaved(true); }}
        />
      </div>
    ) : (
      <>
        <p className={`mt-3 rounded-[10px] px-3 py-2.5 text-sm font-semibold ${windows.length ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "bg-[var(--warn-bg)] text-[var(--warn-ink)]"}`}>
          {summariseCallSchedule(windows)}
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Route plans are built around these timings, so keeping them current is what makes a day&apos;s route workable.
        </p>
        {saved && <div className="mt-3"><Notice tone="success">Call time updated.</Notice></div>}
      </>
    )}
  </Card>;
}
