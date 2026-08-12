"use client";

import { useState } from "react";
import { ExternalLink, MapPin, Phone, Save, Search, Star } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, Spinner } from "@/components/ui/kit";
import {
  LEAD_QUERY_CEILING, LEAD_TYPE_SUGGESTIONS, MAX_LEAD_RESULTS, leadSearchSchema, type DiscoveredLead
} from "@/lib/sales/leads";

/**
 * Searching for a trade in a place, and keeping what comes back.
 *
 * Three things are asked for and all three matter. The query and the location
 * are what Google is told; the **type** is what the results are filed under,
 * and it is the one the search itself cannot supply — "beauty parlour",
 * "beauty parlor" and "ladies salon" are three searches that belong in one
 * list, and only the person typing knows that.
 *
 * Nothing is written until Save. A search costs money and returns a hundred
 * shopfronts of which perhaps twenty are worth ringing, so the results are a
 * proposal: everything arrives ticked, and the ones that are no use are
 * unticked before they reach the list.
 */
export function LeadSearch({ onSaved }: { onSaved: () => void }) {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [type, setType] = useState("");
  const [resultLimit, setResultLimit] = useState("20");

  const [rows, setRows] = useState<DiscoveredLead[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The search the rows on screen came from, carried onto every saved row. */
  const [ran, setRan] = useState<{ query: string; location: string } | null>(null);

  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const limit = Number(resultLimit);
  const limitInvalid = resultLimit !== "" && (!Number.isInteger(limit) || limit < 5 || limit > MAX_LEAD_RESULTS);
  const allSelected = rows.length > 0 && selected.size === rows.length;

  async function search() {
    const parsed = leadSearchSchema.safeParse({ query, location, type, resultLimit: limit });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    setSearching(true); setError(""); setMessage(""); setRows([]); setSelected(new Set());
    try {
      const response = await fetch("/api/sales/leads/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data)
      });
      const json = await response.json() as { error?: string; data?: { items: DiscoveredLead[]; cached: boolean } };
      if (!response.ok) throw new Error(json.error ?? "That search could not be run");

      const items = json.data?.items ?? [];
      setRows(items);
      // Ticked on arrival: saving the lot is the ordinary case, and unticking
      // the three that are obviously wrong is less work than ticking forty.
      setSelected(new Set(items.map(item => item.placeId)));
      setRan({ query: parsed.data.query, location: parsed.data.location });
      setMessage(items.length
        ? `${items.length} found${json.data?.cached ? " · repeated search, answered from memory" : ""}. Untick anything you do not want, then save.`
        : `Nothing matched "${parsed.data.query}" near ${parsed.data.location}. Try a broader word, or a bigger place.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That search could not be run");
    } finally {
      setSearching(false);
    }
  }

  async function save() {
    const keeping = rows.filter(row => selected.has(row.placeId));
    if (!keeping.length) return;

    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/sales/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leads: keeping, searchQuery: ran?.query, searchLocation: ran?.location })
      });
      const json = await response.json() as { error?: string; data?: { created: number; updated: number } };
      if (!response.ok) throw new Error(json.error ?? "Those leads could not be saved");

      const created = json.data?.created ?? 0;
      const updated = json.data?.updated ?? 0;
      setRows([]); setSelected(new Set());
      setMessage(updated
        ? `${created} new lead${created === 1 ? "" : "s"} saved, and ${updated} already on the list ${updated === 1 ? "was" : "were"} refreshed.`
        : `${created} lead${created === 1 ? "" : "s"} saved under ${type}.`);
      onSaved();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Those leads could not be saved");
    } finally {
      setSaving(false);
    }
  }

  const toggle = (placeId: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(placeId)) next.delete(placeId); else next.add(placeId);
    return next;
  });

  const onEnter = (event: React.KeyboardEvent) => { if (event.key === "Enter") search(); };

  return <div className="space-y-5">
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_1fr_auto]">
        <Field label="Search for">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" />
            <input className="input pl-9" value={query} onKeyDown={onEnter}
              onChange={event => setQuery(event.target.value)} placeholder="Beauty parlour" />
          </div>
        </Field>
        <Field label="Location">
          <div className="relative">
            <MapPin size={16} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" />
            <input className="input pl-9" value={location} onKeyDown={onEnter}
              onChange={event => setLocation(event.target.value)} placeholder="Ghaziabad, or a PIN code" />
          </div>
        </Field>
        {/* Hint lives in the label: a hint under the input makes this cell
            taller than its neighbours and drops the button out of line. */}
        <Field label={`Results (5–${MAX_LEAD_RESULTS})`}>
          <input className="input" type="number" inputMode="numeric" min={5} max={MAX_LEAD_RESULTS} step={5}
            value={resultLimit} aria-invalid={limitInvalid} onKeyDown={onEnter}
            onChange={event => setResultLimit(event.target.value.replace(/[^0-9]/g, ""))} />
        </Field>
        <div className="flex items-end">
          <Button onClick={search} busy={searching} disabled={limitInvalid} className="w-full lg:w-auto">
            <Search size={16} />Search
          </Button>
        </div>
      </div>

      <Field label="Save these as"
        hint="The type every result is filed under. Pick one of the suggestions or type your own — this is what you filter the saved list by later.">
        <input className="input" list="lead-types" value={type} onKeyDown={onEnter}
          onChange={event => setType(event.target.value)} placeholder="Beauty parlour" />
        <datalist id="lead-types">
          {LEAD_TYPE_SUGGESTIONS.map(suggestion => <option key={suggestion} value={suggestion} />)}
        </datalist>
      </Field>

      <p className="text-xs text-[var(--muted)]">
        Google caps a single query at {LEAD_QUERY_CEILING} results, so anything past that is covered by asking from a
        ring of points around the location and merging the answers — the same sweep the doctor search uses. A wider
        search therefore costs proportionally more billed requests, and stops the moment it has what you asked for.
        Anything already saved is refreshed rather than filed twice.
      </p>
    </Card>

    {error && <Notice tone="error">{error}</Notice>}
    {message && !error && <Notice>{message}</Notice>}

    {searching && <Spinner label="Searching Google Places…" />}

    {!searching && rows.length > 0 && <>
      {/*
        * Below the app's own header rather than under it: the mobile bar is
        * 56px tall and sticks at the top, so a toolbar pinned to 0 slides
        * behind it and cannot be reached at all.
        */}
      <div className="sticky top-14 z-10 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface-veil)] px-3 py-2.5 backdrop-blur lg:top-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map(row => row.placeId)))} />
          {selected.size ? `${selected.size} of ${rows.length} selected` : "Select all"}
        </label>
        <Button onClick={save} busy={saving} disabled={!selected.size}>
          <Save size={15} />Save {selected.size || ""} as {type || "…"}
        </Button>
      </div>

      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(row => {
          const checked = selected.has(row.placeId);
          return <Card key={row.placeId}
            className={`p-4 transition-colors ${checked ? "border-[var(--brand)] bg-[var(--brand-soft)]/30" : ""}`}>
            <div className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--brand)]" checked={checked}
                onChange={() => toggle(row.placeId)} aria-label={`Select ${row.name}`} />
              <div className="min-w-0 flex-1">
                <h3 className="wrap-break-word text-sm font-semibold">{row.name}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone="brand">{row.type}</Badge>
                  {row.rating !== undefined && (
                    <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
                      <Star size={12} className="fill-amber-400 text-amber-400" />
                      {row.rating} ({row.reviewCount ?? 0})
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-3 space-y-1.5 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-2)]">
              <p className="flex items-start gap-2">
                <MapPin size={13} className="mt-0.5 shrink-0 text-[var(--muted)]" />
                <span className="line-clamp-2">{row.address || "Address not published"}</span>
              </p>
              <p className="flex items-center gap-2">
                <Phone size={13} className="shrink-0 text-[var(--muted)]" />
                {row.phone || "Not published by Google"}
              </p>
            </div>

            {row.mapsUrl && (
              <a href={row.mapsUrl} target="_blank" rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]">
                Open in Maps <ExternalLink size={12} />
              </a>
            )}
          </Card>;
        })}
      </div>
    </>}

    {!searching && !rows.length && !message && (
      <EmptyState icon={Search} title="Search for a trade in a place"
        description="Type what you are looking for, where, and what to file the results under — beauty parlours in Ghaziabad, gyms in Noida. Results appear here ready to keep." />
    )}
  </div>;
}
