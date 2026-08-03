"use client";

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, ExternalLink, MapPin, Phone, RotateCcw, Save, Search, Star, Upload } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { DOCTOR_TYPES, RADIUS_OPTIONS, discoverySchema, fromExcelRow, toExcelRow, type DiscoveredDoctor } from "@/lib/doctors/discovery";

type Row = DiscoveredDoctor & { fromFile?: boolean };

export default function DiscoverPage() {
  const [location, setLocation] = useState("");
  const [radiusKm, setRadiusKm] = useState(10);
  const [types, setTypes] = useState<string[]>(["Dermatologist"]);
  const [resultLimit, setResultLimit] = useState<60 | 120 | 240>(120);

  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ created: number; updated: number; names: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedRows = useMemo(() => rows.filter(row => selected.has(row.placeId)), [rows, selected]);
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleType(type: string) {
    setTypes(current => current.includes(type)
      ? current.filter(item => item !== type)
      : current.length < 4 ? [...current, type] : current);
  }

  async function search() {
    const parsed = discoverySchema.safeParse({ location, radiusKm, doctorTypes: types, resultLimit });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }

    setSearching(true); setError(""); setMessage(""); setRows([]); setSelected(new Set());
    try {
      const response = await fetch("/api/google/doctors", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data)
      });
      const json = await response.json() as { error?: string; data?: { items: DiscoveredDoctor[]; searchedZones: number; cached: boolean } };
      if (!response.ok) throw new Error(json.error ?? "Search failed");
      const items = json.data?.items ?? [];
      setRows(items);
      setMessage(items.length
        ? `${items.length} found across ${json.data?.searchedZones} search area(s)${json.data?.cached ? " · from cache" : ""}.`
        : "No doctors matched. Try a wider radius or another doctor type.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Search failed");
    } finally { setSearching(false); }
  }

  function toggle(placeId: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(placeId)) next.delete(placeId); else next.add(placeId);
      return next;
    });
  }

  async function downloadExcel() {
    if (!rows.length) return;
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows.map(toExcelRow)), "Doctors");
    XLSX.writeFile(book, `bhealix-${location.toLowerCase().replace(/\s+/g, "-") || "search"}.xlsx`);
  }

  async function uploadExcel(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setMessage("");
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]], { defval: "" });
      const parsed = sheet.map(fromExcelRow).filter((row): row is NonNullable<typeof row> => row !== null);
      if (!parsed.length) { setError("No usable rows found. The sheet needs a 'Doctor Name' column."); return; }

      const asRows: Row[] = parsed.map((row, index) => ({
        placeId: row.googlePlaceId ?? `file-${Date.now()}-${index}`,
        fromFile: !row.googlePlaceId,
        name: row.name,
        doctorType: row.specialty,
        address: row.fullAddress,
        area: row.area,
        city: row.city,
        phone: row.phone,
        website: "",
        mapsUrl: row.googleMapsUrl,
        rating: row.rating,
        reviewCount: row.reviewCount,
        latitude: row.latitude ?? 0,
        longitude: row.longitude ?? 0,
        distanceKm: 0
      }));

      setRows(current => [...asRows, ...current]);
      setSelected(current => new Set([...current, ...asRows.map(row => row.placeId)]));
      const noCoords = asRows.filter(row => !row.latitude || !row.longitude).length;
      setMessage(`${asRows.length} row(s) loaded from the file and pre-selected.${noCoords ? ` ${noCoords} have no latitude/longitude and cannot be route-planned until you add one.` : ""}`);
    } catch {
      setError("That file could not be read. Use the same format as the downloaded sheet.");
    }
  }

  async function saveSelected() {
    if (!selectedRows.length) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/doctors/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          doctors: selectedRows.map(row => ({
            ...(row.fromFile ? {} : { googlePlaceId: row.placeId }),
            name: row.name,
            specialty: row.doctorType,
            clinicName: row.name,
            phone: row.phone,
            fullAddress: row.address,
            area: row.area,
            city: row.city,
            googleMapsUrl: row.mapsUrl,
            rating: row.rating,
            reviewCount: row.reviewCount,
            ...(row.latitude && row.longitude ? { latitude: row.latitude, longitude: row.longitude } : {}),
            source: row.fromFile ? "Excel" as const : "Google" as const
          }))
        })
      });
      const json = await response.json() as { error?: string; data?: { created: number; updated: number } };
      if (!response.ok) throw new Error(json.error ?? "Could not save");
      setSaved({ created: json.data?.created ?? 0, updated: json.data?.updated ?? 0, names: selectedRows.map(row => row.name) });
      setSelected(new Set());
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save");
    } finally { setSaving(false); }
  }

  return <div className="space-y-5">
    <PageTitle title="Find doctors" subtitle="Search a location for skin specialists, then save them to your directory" actions={
      <>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={uploadExcel} className="hidden" />
        <Button tone="secondary" onClick={() => fileRef.current?.click()}><Upload size={16} />Upload sheet</Button>
        <Button tone="secondary" onClick={() => { setRows([]); setSelected(new Set()); setMessage(""); setError(""); }}>
          <RotateCcw size={16} />Reset
        </Button>
      </>
    } />

    <Card className="space-y-4 p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
        <Field label="Location">
          <div className="relative">
            <MapPin size={16} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" />
            <input value={location} onChange={e => setLocation(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") search(); }}
              placeholder="Noida, Ghaziabad or a PIN code" className="input pl-9" />
          </div>
        </Field>
        <Field label="Radius">
          <select value={radiusKm} onChange={e => setRadiusKm(Number(e.target.value))} className="select">
            {RADIUS_OPTIONS.map(value => <option key={value} value={value}>{value} km</option>)}
          </select>
        </Field>
        <Field label="Max results">
          <select value={resultLimit} onChange={e => setResultLimit(Number(e.target.value) as 60 | 120 | 240)} className="select">
            <option value={60}>60</option><option value={120}>120</option><option value={240}>240</option>
          </select>
        </Field>
        <div className="flex items-end">
          <Button onClick={search} busy={searching} className="w-full lg:w-auto"><Search size={16} />Search</Button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[13px] font-medium text-[var(--ink-2)]">Doctor type <span className="font-normal text-[var(--muted)]">· up to 4</span></p>
        <div className="flex flex-wrap gap-1.5">
          {DOCTOR_TYPES.map(type => {
            const on = types.includes(type);
            return <button key={type} type="button" onClick={() => toggleType(type)} aria-pressed={on}
              className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold transition-colors ${
                on ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--line-2)] bg-white text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
              }`}>{type}</button>;
          })}
        </div>
      </div>
    </Card>

    {error && <Notice tone="error">{error}</Notice>}
    {message && !error && <Notice>{message}</Notice>}

    {searching && <Spinner label="Searching Google Places…" />}

    {!searching && rows.length > 0 && <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2.5 lg:top-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map(row => row.placeId)))}
            className="size-4 accent-[var(--brand)]" />
          {selected.size ? `${selected.size} selected` : "Select all"}
        </label>
        <div className="flex gap-2">
          <Button tone="secondary" onClick={downloadExcel}><Download size={15} />Excel</Button>
          <Button onClick={saveSelected} busy={saving} disabled={!selected.size}><Save size={15} />Save</Button>
        </div>
      </div>

      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(row => {
          const checked = selected.has(row.placeId);
          return <Card key={row.placeId} className={`p-4 transition-colors ${checked ? "border-[var(--brand)] bg-[var(--brand-soft)]/30" : ""}`}>
            <div className="flex items-start gap-3">
              <input type="checkbox" checked={checked} onChange={() => toggle(row.placeId)}
                aria-label={`Select ${row.name}`} className="mt-1 size-4 shrink-0 accent-[var(--brand)]" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold">{row.name}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone="brand">{row.doctorType}</Badge>
                  {row.fromFile ? <Badge tone="info">From sheet</Badge> : <Badge>{row.distanceKm} km</Badge>}
                  {row.rating !== undefined && <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]"><Star size={12} className="fill-amber-400 text-amber-400" />{row.rating} ({row.reviewCount ?? 0})</span>}
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-1.5 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-2)]">
              <p className="flex items-start gap-2"><MapPin size={13} className="mt-0.5 shrink-0 text-[var(--muted)]" /><span className="line-clamp-2">{row.address || "Address not available"}</span></p>
              <p className="flex items-center gap-2"><Phone size={13} className="shrink-0 text-[var(--muted)]" />{row.phone || "Not published by Google"}</p>
              {(!row.latitude || !row.longitude) && <p className="text-amber-700">No coordinates — cannot be route-planned</p>}
            </div>
            {row.mapsUrl && <a href={row.mapsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]">Open in Maps <ExternalLink size={12} /></a>}
          </Card>;
        })}
      </div>
    </>}

    {!searching && !rows.length && !message && (
      <EmptyState icon={Search} title="Search a location"
        description="Pick a city or PIN code, choose the doctor types you care about, and results appear here ready to save." />
    )}

    {saved && (
      <Modal title="Doctors saved" description={`${saved.created} new · ${saved.updated} updated`} onClose={() => setSaved(null)}
        footer={<Button className="w-full" onClick={() => setSaved(null)}>Done</Button>}>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-700">
          <CheckCircle2 size={17} />{saved.names.length} doctor{saved.names.length === 1 ? "" : "s"} written to your directory
        </div>
        <ul className="divide-y divide-[var(--line)] rounded-[10px] border border-[var(--line)]">
          {saved.names.map((name, index) => <li key={`${name}-${index}`} className="px-3 py-2.5 text-sm">{name}</li>)}
        </ul>
      </Modal>
    )}
  </div>;
}
