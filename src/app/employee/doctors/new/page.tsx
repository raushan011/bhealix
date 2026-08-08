"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, MapPin, Search, Stethoscope, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, Field, Notice, PageTitle } from "@/components/ui/kit";
import { toBulkPayload, type DiscoveredDoctor } from "@/lib/doctors/discovery";

const TABS = [
  { key: "search", label: "Search by name" },
  { key: "manual", label: "Enter by hand" }
] as const;

/**
 * Adding a doctor from the field, the two ways a rep actually meets one.
 *
 * Searching by name is first because it is the better outcome: Google supplies
 * the address and the coordinate, and a doctor without a coordinate cannot be
 * put on a route. Typing by hand is the fallback for a clinic that is not
 * listed anywhere.
 */
export default function AddDoctorFromField() {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("search");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  return <div className="space-y-4">
    <Link href="/employee/doctors" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={15} />Back to doctors
    </Link>
    <PageTitle title="Add a doctor" subtitle="They are added to your own list, and you can set their call time next" />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <div className="flex gap-1.5">
      {TABS.map(({ key, label }) => (
        <button key={key} onClick={() => setTab(key)}
          className={`inline-flex min-h-[38px] flex-1 items-center justify-center rounded-full border px-4 text-xs font-semibold ${
            tab === key ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]"
          }`}>{label}</button>
      ))}
    </div>

    {tab === "search"
      ? <SearchAndAdd onSaved={id => router.push(`/employee/doctors/${id}`)} onError={text => setNotice({ tone: "error", text })} />
      : <ManualAdd onSaved={id => router.push(`/employee/doctors/${id}`)} />}
  </div>;
}

function SearchAndAdd({ onSaved, onError }: { onSaved: (id: string) => void; onError: (text: string) => void }) {
  const [query, setQuery] = useState("");
  const [near, setNear] = useState("");
  const [results, setResults] = useState<DiscoveredDoctor[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function search() {
    if (query.trim().length < 3) { onError("Type at least three letters of the name"); return; }
    setSearching(true); setResults(null);
    try {
      const response = await fetch("/api/google/lookup", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: query.trim(), near: near.trim() || undefined })
      });
      const json = await response.json() as { error?: string; data?: { items: DiscoveredDoctor[] } };
      if (!response.ok) throw new Error(json.error ?? "Could not search right now");
      setResults(json.data?.items ?? []);
    } catch (problem) {
      onError(problem instanceof Error ? problem.message : "Could not search right now");
    } finally { setSearching(false); }
  }

  async function add(found: DiscoveredDoctor) {
    setSavingId(found.placeId);
    try {
      // Saved through the bulk route, which is what knows how to keep a Google
      // place from being added to the directory twice.
      const response = await fetch("/api/doctors/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ doctors: [toBulkPayload(found)] })
      });
      const json = await response.json() as { error?: string; data?: { savedIds: string[] } };
      if (!response.ok) throw new Error(json.error ?? "Could not save this doctor");
      const id = json.data?.savedIds?.[0];
      if (!id) throw new Error("That doctor is already in the directory");
      onSaved(id);
    } catch (problem) {
      onError(problem instanceof Error ? problem.message : "Could not save this doctor");
      setSavingId(null);
    }
  }

  return <div className="space-y-4">
    <Card className="space-y-3 p-4">
      <Field label="Doctor or clinic name">
        <input value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") search(); }}
          className="input" placeholder="Dr Anita Sharma" />
      </Field>
      <Field label="Area or city" hint="Optional, but it makes the match far better">
        <input value={near} onChange={e => setNear(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") search(); }}
          className="input" placeholder="Koramangala, Bengaluru" />
      </Field>
      <Button onClick={search} busy={searching} className="w-full"><Search size={16} />Search</Button>
    </Card>

    {results !== null && !results.length && (
      <Card className="px-4 py-8 text-center">
        <Stethoscope size={22} className="mx-auto text-[var(--line-2)]" />
        <p className="mt-2 text-sm text-[var(--muted)]">Nothing found. Try the clinic name, or add them by hand.</p>
      </Card>
    )}

    {results?.map(found => (
      <Card key={found.placeId} className="p-4">
        <p className="text-sm font-semibold">{found.name}</p>
        <p className="mt-0.5 flex items-start gap-1.5 text-xs text-[var(--muted)]">
          <MapPin size={12} className="mt-0.5 shrink-0" />
          {found.address || [found.area, found.city].filter(Boolean).join(", ") || "No address"}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {found.latitude && found.longitude
            ? <Badge tone="success">Can be routed</Badge>
            : <Badge tone="warn">No map location</Badge>}
          {found.phone && <span className="text-xs text-[var(--muted)]">{found.phone}</span>}
        </div>
        <Button className="mt-3 w-full" busy={savingId === found.placeId} onClick={() => add(found)}>
          <Check size={15} />Add to my doctors
        </Button>
      </Card>
    ))}
  </div>;
}

function ManualAdd({ onSaved }: { onSaved: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);

  /**
   * The rep is usually standing in the clinic when they add it, so their own
   * position is the best coordinate anybody is going to get — and without one
   * the doctor cannot be put on a route.
   */
  function useMyLocation() {
    if (!navigator.geolocation) { setError("This phone cannot report its location"); return; }
    setLocating(true); setError("");
    navigator.geolocation.getCurrentPosition(
      position => {
        setCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocating(false);
      },
      () => { setError("Could not read your location. Allow location access, or leave it blank."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  async function create(data: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/doctors", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          clinicName: data.get("clinicName") || undefined,
          specialties: String(data.get("specialties") ?? "").split(",").map(s => s.trim()).filter(Boolean),
          phones: data.get("phone") ? [data.get("phone")] : [],
          fullAddress: data.get("fullAddress") || undefined,
          area: data.get("area") || undefined,
          city: data.get("city") || undefined,
          priority: data.get("priority"),
          notes: data.get("notes") || undefined,
          ...(coordinates ?? {})
        })
      });
      const json = await response.json() as { error?: string; data?: { _id: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not add this doctor");
      onSaved(String(json.data?._id));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not add this doctor");
      setBusy(false);
    }
  }

  return <form action={create}>
    <Card className="space-y-4 p-4">
      <Field label="Doctor name"><input name="name" required minLength={2} className="input" placeholder="Dr Anita Sharma" /></Field>
      <Field label="Clinic"><input name="clinicName" className="input" /></Field>
      <Field label="Speciality" hint="Separate with commas"><input name="specialties" className="input" placeholder="Dermatologist" /></Field>
      <Field label="Phone"><input name="phone" className="input" inputMode="tel" /></Field>
      <Field label="Address"><input name="fullAddress" className="input" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Area"><input name="area" className="input" /></Field>
        <Field label="City"><input name="city" className="input" /></Field>
      </div>
      <Field label="Priority">
        <select name="priority" defaultValue="Medium" className="select">
          {["Hot", "High", "Medium", "Low"].map(value => <option key={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Notes"><textarea name="notes" className="textarea" placeholder="Met at the clinic, asked to call back next week" /></Field>

      <div className="rounded-[10px] border border-[var(--line)] p-3">
        <p className="text-[13px] font-medium text-[var(--ink-2)]">Map location</p>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Without one this doctor cannot be placed on a route. If you are at the clinic now, this is the moment to catch it.
        </p>
        {coordinates ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--ok-ink)]">
            <Check size={13} />Saved: {coordinates.latitude.toFixed(5)}, {coordinates.longitude.toFixed(5)}
          </p>
        ) : (
          <Button type="button" tone="secondary" className="mt-2 w-full" busy={locating} onClick={useMyLocation}>
            <MapPin size={15} />Use my current location
          </Button>
        )}
      </div>

      {!coordinates && (
        <p className="flex items-start gap-2 text-xs text-[var(--warn-ink)]">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          You can save without a location and add it on your next visit.
        </p>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" busy={busy} className="w-full">{busy ? "Saving…" : "Add doctor"}</Button>
    </Card>
  </form>;
}
