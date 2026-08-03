"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Notice } from "@/components/ui/kit";

export type DoctorFormValues = {
  _id: string; name: string; clinicName: string; specialties: string[];
  phone: string; email: string; fullAddress: string; area: string; city: string;
  latitude?: number; longitude?: number; priority: string; stage: string; notes: string;
};

const PRIORITIES = ["Hot", "High", "Medium", "Low"];
const STAGES = ["New", "Contacted", "Interested", "Prescribing", "Not interested"];

export function DoctorDetailsForm({ doctor }: { doctor: DoctorFormValues }) {
  const router = useRouter();
  const [form, setForm] = useState(doctor);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const set = <K extends keyof DoctorFormValues>(key: K, value: DoctorFormValues[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  async function save() {
    setSaving(true); setResult(null);
    try {
      const response = await fetch(`/api/doctors/${doctor._id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          clinicName: form.clinicName,
          specialties: form.specialties,
          phones: form.phone ? [form.phone] : [],
          email: form.email,
          fullAddress: form.fullAddress,
          area: form.area,
          city: form.city,
          priority: form.priority,
          stage: form.stage,
          notes: form.notes,
          ...(form.latitude !== undefined && form.longitude !== undefined
            ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : {})
        })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not save changes");
      setResult({ tone: "success", text: "Changes saved." });
      router.refresh();
    } catch (problem) {
      setResult({ tone: "error", text: problem instanceof Error ? problem.message : "Could not save changes" });
    } finally { setSaving(false); }
  }

  return <Card className="p-5">
    <h2 className="text-[15px] font-semibold">Doctor details</h2>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Field label="Doctor name"><input value={form.name} onChange={e => set("name", e.target.value)} className="input" /></Field>
      <Field label="Clinic"><input value={form.clinicName} onChange={e => set("clinicName", e.target.value)} className="input" /></Field>
      <Field label="Specialities" hint="Separate with commas">
        <input value={form.specialties.join(", ")} onChange={e => set("specialties", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} className="input" />
      </Field>
      <Field label="Phone"><input value={form.phone} onChange={e => set("phone", e.target.value)} className="input" /></Field>
      <Field label="Email"><input value={form.email} onChange={e => set("email", e.target.value)} className="input" /></Field>
      <Field label="Area"><input value={form.area} onChange={e => set("area", e.target.value)} className="input" /></Field>
      <Field label="City"><input value={form.city} onChange={e => set("city", e.target.value)} className="input" /></Field>
      <div className="sm:col-span-2">
        <Field label="Full address"><input value={form.fullAddress} onChange={e => set("fullAddress", e.target.value)} className="input" /></Field>
      </div>
      <Field label="Latitude" hint="Needed for route planning">
        <input type="number" step="any" value={form.latitude ?? ""} onChange={e => set("latitude", e.target.value === "" ? undefined : Number(e.target.value))} className="input" />
      </Field>
      <Field label="Longitude" hint="Needed for route planning">
        <input type="number" step="any" value={form.longitude ?? ""} onChange={e => set("longitude", e.target.value === "" ? undefined : Number(e.target.value))} className="input" />
      </Field>
      <Field label="Priority">
        <select value={form.priority} onChange={e => set("priority", e.target.value)} className="select">
          {PRIORITIES.map(value => <option key={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Stage">
        <select value={form.stage} onChange={e => set("stage", e.target.value)} className="select">
          {STAGES.map(value => <option key={value}>{value}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes"><textarea value={form.notes} onChange={e => set("notes", e.target.value)} className="textarea" /></Field>
      </div>
    </div>

    {result && <div className="mt-4"><Notice tone={result.tone}>{result.text}</Notice></div>}
    <div className="mt-4 flex justify-end"><Button onClick={save} busy={saving}>{saving ? "Saving…" : "Save changes"}</Button></div>
  </Card>;
}
