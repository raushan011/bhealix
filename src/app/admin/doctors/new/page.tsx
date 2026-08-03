"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button, Card, Field, Notice, PageTitle } from "@/components/ui/kit";

export default function NewDoctor() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(data: FormData) {
    setBusy(true); setError("");
    const latitude = data.get("latitude"), longitude = data.get("longitude");
    try {
      const response = await fetch("/api/doctors", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          clinicName: data.get("clinicName") || undefined,
          specialties: String(data.get("specialties") ?? "").split(",").map(s => s.trim()).filter(Boolean),
          phones: data.get("phone") ? [data.get("phone")] : [],
          email: data.get("email") || undefined,
          fullAddress: data.get("fullAddress") || undefined,
          area: data.get("area") || undefined,
          city: data.get("city") || undefined,
          priority: data.get("priority"),
          ...(latitude && longitude ? { latitude: Number(latitude), longitude: Number(longitude) } : {})
        })
      });
      const json = await response.json() as { error?: string; data?: { _id: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not add this doctor");
      router.push(`/admin/doctors/${json.data?._id}`);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not add this doctor");
      setBusy(false);
    }
  }

  return <div className="space-y-5">
    <Link href="/admin/doctors" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={15} />Back to directory
    </Link>
    <PageTitle title="Add doctor" subtitle="You can set the MR call time straight after saving" />

    <form action={create}>
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Doctor name"><input name="name" required className="input" placeholder="Dr. A. Sharma" /></Field>
          <Field label="Clinic"><input name="clinicName" className="input" /></Field>
          <Field label="Specialities" hint="Separate with commas"><input name="specialties" className="input" placeholder="Dermatologist" /></Field>
          <Field label="Phone"><input name="phone" className="input" /></Field>
          <Field label="Email"><input name="email" type="email" className="input" /></Field>
          <Field label="Area"><input name="area" className="input" /></Field>
          <Field label="City"><input name="city" className="input" /></Field>
          <Field label="Priority">
            <select name="priority" defaultValue="Medium" className="select">
              {["Hot", "High", "Medium", "Low"].map(value => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2"><Field label="Full address"><input name="fullAddress" className="input" /></Field></div>
          <Field label="Latitude" hint="Required for route planning"><input name="latitude" type="number" step="any" className="input" /></Field>
          <Field label="Longitude" hint="Required for route planning"><input name="longitude" type="number" step="any" className="input" /></Field>
        </div>
        {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}
        <div className="mt-5 flex justify-end"><Button type="submit" busy={busy}>{busy ? "Saving…" : "Add doctor"}</Button></div>
      </Card>
    </form>
  </div>;
}
