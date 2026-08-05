"use client";

import { useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  MapPin,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Search,
  Star,
  Upload,
  UserSearch,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Notice,
  PageTitle,
  Spinner,
} from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import {
  DOCTOR_TYPES,
  MAX_RESULTS,
  RADIUS_OPTIONS,
  discoverySchema,
  estimateGoogleRequests,
  fromExcelRow,
  lookupSchema,
  toBulkPayload,
  toExcelRow,
  type DiscoveredDoctor,
} from "@/lib/doctors/discovery";

type Row = DiscoveredDoctor & { fromFile?: boolean };
type Mode = "area" | "name";

const toPayload = toBulkPayload;

export default function DiscoverPage() {
  const [mode, setMode] = useState<Mode>("area");

  // Area sweep
  const [location, setLocation] = useState("");
  const [radiusKm, setRadiusKm] = useState(10);
  const [types, setTypes] = useState<string[]>(["Dermatologist"]);
  const [resultLimit, setResultLimit] = useState("120");
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Name lookup
  const [name, setName] = useState("");
  const [near, setNear] = useState("");
  const [matches, setMatches] = useState<DiscoveredDoctor[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string>();

  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{
    created: number;
    updated: number;
    names: string[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.placeId)),
    [rows, selected],
  );
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setMessage("");
  }

  function toggleType(type: string) {
    setTypes((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type],
    );
  }

  async function searchArea() {
    const parsed = discoverySchema.safeParse({
      location,
      radiusKm,
      doctorTypes: types,
      resultLimit: Number(resultLimit),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    setSearching(true);
    setError("");
    setMessage("");
    setRows([]);
    setSelected(new Set());
    try {
      const response = await fetch("/api/google/doctors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = (await response.json()) as {
        error?: string;
        data?: {
          items: DiscoveredDoctor[];
          searchedZones: number;
          cached: boolean;
        };
      };
      if (!response.ok) throw new Error(json.error ?? "Search failed");
      const items = json.data?.items ?? [];
      setRows(items);
      setMessage(
        items.length
          ? `${items.length} found across ${json.data?.searchedZones} search area(s)${json.data?.cached ? " · from cache" : ""}.`
          : "No doctors matched. Try a wider radius or another doctor type.",
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function searchByName() {
    const parsed = lookupSchema.safeParse({
      query: name,
      near: near || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    setSearching(true);
    setError("");
    setMessage("");
    setMatches([]);
    try {
      const response = await fetch("/api/google/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = (await response.json()) as {
        error?: string;
        data?: { items: DiscoveredDoctor[] };
      };
      if (!response.ok) throw new Error(json.error ?? "Lookup failed");
      const items = json.data?.items ?? [];
      setMatches(items);
      if (!items.length)
        setMessage("Nothing matched that name. Try adding the area or city.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Lookup failed");
    } finally {
      setSearching(false);
    }
  }

  async function addOne(doctor: DiscoveredDoctor) {
    setAddingId(doctor.placeId);
    setError("");
    try {
      const response = await fetch("/api/doctors/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doctors: [toPayload(doctor)] }),
      });
      const json = (await response.json()) as {
        error?: string;
        data?: { created: number; updated: number };
      };
      if (!response.ok)
        throw new Error(json.error ?? "Could not add this doctor");
      setAdded((current) => new Set(current).add(doctor.placeId));
      setMessage(
        json.data?.updated
          ? `${doctor.name} was already in the directory and has been refreshed.`
          : `${doctor.name} added to the directory.`,
      );
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Could not add this doctor",
      );
    } finally {
      setAddingId(undefined);
    }
  }

  function toggle(placeId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  }

  async function downloadExcel() {
    if (!rows.length) return;
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(rows.map(toExcelRow)),
      "Doctors",
    );
    XLSX.writeFile(
      book,
      `bhealix-${location.toLowerCase().replace(/\s+/g, "-") || "search"}.xlsx`,
    );
  }

  async function uploadExcel(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setMessage("");
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        book.Sheets[book.SheetNames[0]],
        { defval: "" },
      );
      const parsed = sheet
        .map(fromExcelRow)
        .filter((row): row is NonNullable<typeof row> => row !== null);
      if (!parsed.length) {
        setError(
          "No usable rows found. The sheet needs a 'Doctor Name' column.",
        );
        return;
      }

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
        distanceKm: 0,
      }));

      setMode("area");
      setRows((current) => [...asRows, ...current]);
      setSelected(
        (current) => new Set([...current, ...asRows.map((row) => row.placeId)]),
      );
      const noCoords = asRows.filter(
        (row) => !row.latitude || !row.longitude,
      ).length;
      setMessage(
        `${asRows.length} row(s) loaded from the file and pre-selected.${noCoords ? ` ${noCoords} have no latitude/longitude and cannot be route-planned until you add one.` : ""}`,
      );
    } catch {
      setError(
        "That file could not be read. Use the same format as the downloaded sheet.",
      );
    }
  }

  async function saveSelected() {
    if (!selectedRows.length) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/doctors/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doctors: selectedRows.map(toPayload) }),
      });
      const json = (await response.json()) as {
        error?: string;
        data?: { created: number; updated: number };
      };
      if (!response.ok) throw new Error(json.error ?? "Could not save");
      setSaved({
        created: json.data?.created ?? 0,
        updated: json.data?.updated ?? 0,
        names: selectedRows.map((row) => row.name),
      });
      setSelected(new Set());
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const limitNumber = Number(resultLimit);
  const limitInvalid =
    resultLimit !== "" &&
    (!Number.isInteger(limitNumber) ||
      limitNumber < 10 ||
      limitNumber > MAX_RESULTS);

  const allTypesSelected = types.length === DOCTOR_TYPES.length;
  // Shown so a wide search is a deliberate choice, not a surprise on the bill.
  const estimatedRequests = estimateGoogleRequests(
    types.length,
    limitInvalid || !limitNumber ? 120 : limitNumber,
  );

  return (
    <div className="space-y-5">
      <PageTitle
        title="Find doctors"
        subtitle="Sweep an area, or look up one doctor by name"
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={uploadExcel}
              className="hidden"
            />
            <Button tone="secondary" onClick={() => fileRef.current?.click()}>
              <Upload size={16} />
              Upload sheet
            </Button>
            <Button
              tone="secondary"
              onClick={() => {
                setRows([]);
                setSelected(new Set());
                setMatches([]);
                setAdded(new Set());
                setMessage("");
                setError("");
              }}
            >
              <RotateCcw size={16} />
              Reset
            </Button>
          </>
        }
      />

      <div className="flex gap-1.5 rounded-[10px] border border-[var(--line)] bg-white p-1">
        {(
          [
            ["area", "Search an area", Search],
            ["name", "Find by name", UserSearch],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => switchMode(value)}
            aria-pressed={mode === value}
            className={`flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors ${
              mode === value
                ? "bg-[var(--brand)] text-white"
                : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {mode === "area" ? (
        <Card className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
            <Field label="Location">
              <div className="relative">
                <MapPin
                  size={16}
                  className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]"
                />
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") searchArea();
                  }}
                  placeholder="Noida, Ghaziabad or a PIN code"
                  className="input pl-9"
                />
              </div>
            </Field>
            <Field label="Radius">
              <select
                value={radiusKm}
                onChange={(e) => setRadiusKm(Number(e.target.value))}
                className="select"
              >
                {RADIUS_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} km
                  </option>
                ))}
              </select>
            </Field>
            {/* Hint lives in the label: a hint under the input makes this cell
                taller than its neighbours and drops the button out of line. */}
            <Field label={`Max results (10–${MAX_RESULTS})`}>
              <input
                type="number"
                inputMode="numeric"
                min={10}
                max={MAX_RESULTS}
                step={10}
                value={resultLimit}
                onChange={(e) =>
                  setResultLimit(e.target.value.replace(/[^0-9]/g, ""))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") searchArea();
                }}
                aria-invalid={limitInvalid}
                className="input"
              />
            </Field>
            <div className="flex items-end">
              <Button
                onClick={searchArea}
                busy={searching}
                disabled={limitInvalid}
                className="w-full lg:w-auto"
              >
                <Search size={16} />
                Search
              </Button>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[13px] font-medium text-[var(--ink-2)]">
                Doctor type{" "}
                <span className="font-normal text-[var(--muted)]">
                  · {types.length} of {DOCTOR_TYPES.length} selected
                </span>
              </p>
              <button
                type="button"
                onClick={() =>
                  setTypes(allTypesSelected ? [] : [...DOCTOR_TYPES])
                }
                className="text-xs font-semibold text-[var(--brand)]"
              >
                {allTypesSelected ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DOCTOR_TYPES.map((type) => {
                const on = types.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggleType(type)}
                    aria-pressed={on}
                    className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold transition-colors ${
                      on
                        ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                        : "border-[var(--line-2)] bg-white text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                    }`}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          </div>
          {estimatedRequests > 60 && (
            <p className="text-xs text-[var(--muted)]">
              This search sweeps {types.length} doctor type
              {types.length === 1 ? "" : "s"} across the whole radius — up to{" "}
              <strong className="font-semibold text-[var(--ink-2)]">
                {estimatedRequests} Google Places requests
              </strong>
              , which counts against your billed quota. It stops early once the
              result limit is reached, so a narrower radius or fewer types costs
              less.
            </p>
          )}
        </Card>
      ) : (
        <Card className="p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto]">
            <Field label="Doctor or clinic name">
              <div className="relative">
                <UserSearch
                  size={16}
                  className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]"
                />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") searchByName();
                  }}
                  placeholder="Dr Ranjana Singh Cosmetologist"
                  className="input pl-9"
                />
              </div>
            </Field>
            <Field label="Near (optional)">
              <input
                value={near}
                onChange={(e) => setNear(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") searchByName();
                }}
                placeholder="Ghaziabad"
                className="input"
              />
            </Field>
            <div className="flex items-end">
              <Button
                onClick={searchByName}
                busy={searching}
                className="w-full sm:w-auto"
              >
                <Search size={16} />
                Find
              </Button>
            </div>
          </div>
        </Card>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {message && !error && <Notice>{message}</Notice>}

      {searching && (
        <Spinner
          label={
            mode === "area"
              ? "Searching Google Places…"
              : "Looking up that name…"
          }
        />
      )}

      {mode === "name" && !searching && matches.length > 0 && (
        <div className="space-y-2.5">
          {matches.map((match) => {
            const isAdded = added.has(match.placeId);
            return (
              <Card
                key={match.placeId}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">{match.name}</h3>
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-[var(--ink-2)]">
                    <MapPin
                      size={12}
                      className="mt-0.5 shrink-0 text-[var(--muted)]"
                    />
                    {match.address || "Address not available"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                    <span className="flex items-center gap-1">
                      <Phone size={11} />
                      {match.phone || "No phone"}
                    </span>
                    {match.rating !== undefined && (
                      <span className="flex items-center gap-1">
                        <Star
                          size={11}
                          className="fill-amber-400 text-amber-400"
                        />
                        {match.rating} ({match.reviewCount ?? 0})
                      </span>
                    )}
                    {match.mapsUrl && (
                      <a
                        href={match.mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 font-semibold text-[var(--brand)]"
                      >
                        Maps <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
                {isAdded ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                    <Check size={14} />
                    Added
                  </span>
                ) : (
                  <Button
                    onClick={() => addOne(match)}
                    busy={addingId === match.placeId}
                    className="shrink-0"
                  >
                    <Plus size={15} />
                    Add
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {mode === "area" && !searching && rows.length > 0 && (
        <>
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2.5 lg:top-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  setSelected(
                    allSelected
                      ? new Set()
                      : new Set(rows.map((row) => row.placeId)),
                  )
                }
                className="size-4 accent-[var(--brand)]"
              />
              {selected.size ? `${selected.size} selected` : "Select all"}
            </label>
            <div className="flex gap-2">
              <Button tone="secondary" onClick={downloadExcel}>
                <Download size={15} />
                Excel
              </Button>
              <Button
                onClick={saveSelected}
                busy={saving}
                disabled={!selected.size}
              >
                <Save size={15} />
                Save
              </Button>
            </div>
          </div>

          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => {
              const checked = selected.has(row.placeId);
              return (
                <Card
                  key={row.placeId}
                  className={`p-4 transition-colors ${checked ? "border-[var(--brand)] bg-[var(--brand-soft)]/30" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(row.placeId)}
                      aria-label={`Select ${row.name}`}
                      className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">
                        {row.name}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone="brand">{row.doctorType}</Badge>
                        {row.fromFile ? (
                          <Badge tone="info">From sheet</Badge>
                        ) : (
                          <Badge>{row.distanceKm} km</Badge>
                        )}
                        {row.rating !== undefined && (
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
                            <Star
                              size={12}
                              className="fill-amber-400 text-amber-400"
                            />
                            {row.rating} ({row.reviewCount ?? 0})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1.5 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-2)]">
                    <p className="flex items-start gap-2">
                      <MapPin
                        size={13}
                        className="mt-0.5 shrink-0 text-[var(--muted)]"
                      />
                      <span className="line-clamp-2">
                        {row.address || "Address not available"}
                      </span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Phone
                        size={13}
                        className="shrink-0 text-[var(--muted)]"
                      />
                      {row.phone || "Not published by Google"}
                    </p>
                    {(!row.latitude || !row.longitude) && (
                      <p className="text-amber-700">
                        No coordinates — cannot be route-planned
                      </p>
                    )}
                  </div>
                  {row.mapsUrl && (
                    <a
                      href={row.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]"
                    >
                      Open in Maps <ExternalLink size={12} />
                    </a>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {!searching &&
        !rows.length &&
        !matches.length &&
        !message &&
        (mode === "area" ? (
          <EmptyState
            icon={Search}
            title="Search a location"
            description="Pick a city or PIN code, choose the doctor types you care about, and results appear here ready to save."
          />
        ) : (
          <EmptyState
            icon={UserSearch}
            title="Look up a doctor"
            description="Type the name of a doctor or clinic you already know about and add it straight to the directory."
          />
        ))}

      {saved && (
        <Modal
          title="Doctors saved"
          description={`${saved.created} new · ${saved.updated} updated`}
          onClose={() => setSaved(null)}
          footer={
            <Button className="w-full" onClick={() => setSaved(null)}>
              Done
            </Button>
          }
        >
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-700">
            <CheckCircle2 size={17} />
            {saved.names.length} doctor{saved.names.length === 1 ? "" : "s"}{" "}
            written to your directory
          </div>
          <ul className="divide-y divide-[var(--line)] rounded-[10px] border border-[var(--line)]">
            {saved.names.map((name, index) => (
              <li key={`${name}-${index}`} className="px-3 py-2.5 text-sm">
                {name}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
