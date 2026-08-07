"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Camera, Crosshair, MapPin, Navigation, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Card, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { daysLeft, MAX_PHOTOS_PER_VISIT, PHOTO_RETENTION_DAYS } from "@/lib/visits";
import {
  completeFix, formatAccuracy, formatLatitude, formatLongitude, mapsPointUrl, stampLines, type Fix
} from "@/lib/geo";

export type PhotoLocation = Fix & { address?: string; area?: string; city?: string };
export type VisitPhoto = {
  _id: string; createdAt: string; expiresAt: string; caption?: string; location?: PhotoLocation;
};

/** Longest edge kept. A clinic board, a visiting card and a shelf all read clearly at this. */
const MAX_EDGE = 1600;
const QUALITY = 0.72;

/** Long enough for a cold GPS start in a clinic doorway, short enough not to strand the rep. */
const FIX_TIMEOUT_MS = 12_000;
/** A fix from the last half minute is the same doorway; taking it saves a wait per photo. */
const FIX_MAX_AGE_MS = 30_000;

/**
 * The position the phone is at, or null if it will not say.
 *
 * Never rejects. A refused permission, a switched-off GPS and a timeout are all
 * the same thing here — a photo with no fix, which is still worth uploading and
 * is stamped as unlocated so nobody later mistakes it for a located one.
 */
function currentFix(): Promise<Fix | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => resolve(completeFix(position.coords) ?? null),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge: FIX_MAX_AGE_MS }
    );
  });
}

/**
 * The street address for a fix. Resolved on the server, where the Maps key
 * lives; anything that goes wrong leaves the coordinates to speak for
 * themselves rather than holding up the upload.
 */
async function placeNameFor(fix: Fix): Promise<Partial<PhotoLocation>> {
  try {
    const response = await fetch(`/api/google/reverse?lat=${fix.latitude}&lng=${fix.longitude}`);
    if (!response.ok) return {};
    const json = await response.json() as { data?: { address?: string; area?: string; city?: string } };
    return json.data ?? {};
  } catch {
    return {};
  }
}

/** Splits a line to fit the canvas, so a long address wraps instead of running off the edge. */
function wrap(context: CanvasRenderingContext2D, line: string, maxWidth: number): string[] {
  if (context.measureText(line).width <= maxWidth) return [line];
  const rows: string[] = [];
  let row = "";
  for (const word of line.split(" ")) {
    const candidate = row ? `${row} ${word}` : word;
    if (row && context.measureText(candidate).width > maxWidth) { rows.push(row); row = word; }
    else row = candidate;
  }
  if (row) rows.push(row);
  return rows;
}

/**
 * Burns the place and time across the foot of the photo.
 *
 * The stamp is part of the picture rather than metadata beside it because
 * metadata does not survive the journey: the downscale above discards the
 * camera's EXIF geotag, and even an intact one is invisible to whoever opens
 * the image to settle a question. Dark gradient behind light text, so it stays
 * readable over a bright clinic front or a dim corridor alike.
 */
function stamp(context: CanvasRenderingContext2D, width: number, height: number, lines: string[]) {
  const pad = Math.round(width * 0.028);
  const size = Math.max(13, Math.round(width * 0.026));
  const family = `"Segoe UI", Roboto, system-ui, sans-serif`;
  const lead = Math.round(size * 1.45);

  context.font = `600 ${size}px ${family}`;
  const rows = lines.flatMap((line, index) =>
    wrap(context, line, width - pad * 2).map(text => ({ text, head: index === 0 })));

  const block = rows.length * lead;
  const panel = block + pad * 1.6;
  const gradient = context.createLinearGradient(0, height - panel * 1.5, 0, height);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.45, "rgba(0,0,0,0.55)");
  gradient.addColorStop(1, "rgba(0,0,0,0.82)");
  context.fillStyle = gradient;
  context.fillRect(0, height - panel * 1.5, width, panel * 1.5);

  // A hairline above the block separates it from the photograph itself.
  context.fillStyle = "rgba(255,255,255,0.28)";
  context.fillRect(pad, height - panel, width - pad * 2, Math.max(1, Math.round(size * 0.06)));

  context.textBaseline = "top";
  let y = height - block - pad * 0.55;
  for (const row of rows) {
    context.font = `${row.head ? 700 : 500} ${size}px ${family}`;
    context.fillStyle = row.head ? "#ffffff" : "rgba(255,255,255,0.92)";
    // Drawn twice, offset: a shadow keeps light text legible over a white wall.
    context.shadowColor = "rgba(0,0,0,0.85)";
    context.shadowBlur = Math.round(size * 0.35);
    context.fillText(row.text, pad, y);
    context.shadowBlur = 0;
    y += lead;
  }
}

/**
 * Shrinks a camera photo and stamps it, before it leaves the phone.
 *
 * A rep is usually on mobile data in a corridor, and a modern phone camera
 * produces four or five megabytes of detail nobody will ever look at. Doing
 * this here rather than on the server means the slow part — the upload — is the
 * part that gets smaller, and the stamp is applied to what actually gets sent.
 * If the browser cannot do it the original is sent unchanged; the coordinates
 * are still stored beside it, and the server's size ceiling still applies.
 */
async function prepare(file: File, lines: string[]): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) { bitmap.close(); return file; }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    stamp(context, canvas.width, canvas.height, lines);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    // Unlike a plain resize, the result is kept even when it is the larger of
    // the two — the original has no stamp on it, so it is not the same photo.
    return blob ?? file;
  } catch {
    return file;
  }
}

/** The one line under a thumbnail, and in the audit: where this was taken. */
function placeSummary(location?: PhotoLocation | null): string {
  if (!location || typeof location.latitude !== "number") return "";
  return location.address?.trim()
    || [location.area, location.city].filter(Boolean).join(", ")
    || `${formatLatitude(location.latitude)}, ${formatLongitude(location.longitude)}`;
}

const isLocated = (photo: VisitPhoto) => typeof photo.location?.latitude === "number";

export function VisitPhotos({ visitId, initial, canAdd }: {
  visitId: string; initial: VisitPhoto[]; canAdd: boolean;
}) {
  const [photos, setPhotos] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [viewing, setViewing] = useState<VisitPhoto | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const full = photos.length >= MAX_PHOTOS_PER_VISIT;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(""); setWarning("");
    try {
      const room = MAX_PHOTOS_PER_VISIT - photos.length;
      const chosen = Array.from(files).slice(0, room);

      // The fix is taken now, with the rep still standing where the photo was
      // taken, and one fix covers the batch — they came off the same camera in
      // the same doorway seconds apart.
      setStage("Finding your location…");
      const fix = await currentFix();
      const place = fix ? await placeNameFor(fix) : {};
      const lines = stampLines({ fix, address: place.address, takenAt: new Date() });

      setStage(fix ? "Stamping the location on…" : "Preparing…");
      const body = new FormData();
      for (const file of chosen) {
        const blob = await prepare(file, lines);
        body.append("photo", blob, file.name.replace(/\.[^.]+$/, "") + ".jpg");
      }
      if (fix) {
        body.append("latitude", String(fix.latitude));
        body.append("longitude", String(fix.longitude));
        if (fix.accuracy !== undefined) body.append("accuracy", String(fix.accuracy));
        if (place.address) body.append("address", place.address);
        if (place.area) body.append("area", place.area);
        if (place.city) body.append("city", place.city);
      }

      setStage("Uploading…");
      const response = await fetch(`/api/visits/${visitId}/photos`, { method: "POST", body });
      const json = await response.json() as { error?: string; data?: { items: VisitPhoto[] } };
      if (!response.ok) throw new Error(json.error ?? "Could not upload that photo");
      setPhotos(current => [...current, ...(json.data?.items ?? [])]);

      if (!fix) {
        setWarning("Saved without a location — your phone did not share one. Turn on location for this site and add the photo again if you need it stamped.");
      }
      if (chosen.length < files.length) {
        setError(`Only ${room} more photo${room === 1 ? "" : "s"} could be added to this visit.`);
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not upload that photo");
    } finally {
      setBusy(false);
      setStage("");
      if (input.current) input.current.value = "";
    }
  }

  async function remove(photo: VisitPhoto) {
    if (!window.confirm("Remove this photo?")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/visits/${visitId}/photos/${photo._id}`, { method: "DELETE" });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not remove that photo");
      setPhotos(current => current.filter(item => item._id !== photo._id));
      setViewing(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not remove that photo");
    } finally { setBusy(false); }
  }

  return <Card className="space-y-3 p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <Camera size={15} className="text-[var(--brand)]" />Photos
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {photos.length ? `${photos.length} of ${MAX_PHOTOS_PER_VISIT} attached` : "The clinic, a prescription pad, a visiting card — whatever proves the call."}
        </p>
      </div>
      {canAdd && (
        <Button tone="secondary" className="!min-h-9 shrink-0 !px-3 text-xs" busy={busy} disabled={full}
          onClick={() => input.current?.click()}>
          <Camera size={14} />Add
        </Button>
      )}
    </div>

    {/* `capture` opens the camera straight away on a phone; a file can still be
        picked on a desktop, where the attribute is ignored. */}
    <input ref={input} type="file" accept="image/*" capture="environment" multiple className="hidden"
      onChange={event => upload(event.target.files)} />

    {busy && stage && <p className="text-xs font-medium text-[var(--brand)]">{stage}</p>}

    {photos.length > 0 && (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map(photo => (
          <button key={photo._id} type="button" onClick={() => setViewing(photo)}
            className="relative aspect-square overflow-hidden rounded-[10px] border border-[var(--line-2)] bg-[var(--surface-2)]">
            <Image src={`/api/visits/${visitId}/photos/${photo._id}`} alt="Photo from this visit"
              fill unoptimized sizes="120px" className="object-cover" />
            {/* Says at a glance which photos carry a position — the stamp on the
                image says the same, but at thumbnail size it cannot be read. */}
            <span className={`absolute bottom-1 left-1 grid size-5 place-items-center rounded-full ${
              isLocated(photo) ? "bg-emerald-600/90 text-white" : "bg-black/60 text-white/80"
            }`} title={isLocated(photo) ? placeSummary(photo.location) : "No location"}>
              {isLocated(photo) ? <MapPin size={11} /> : <Crosshair size={11} />}
            </span>
          </button>
        ))}
      </div>
    )}

    {!photos.length && !canAdd && <p className="text-sm text-[var(--muted)]">No photos were attached to this visit.</p>}

    {error && <Notice tone="error">{error}</Notice>}
    {warning && <Notice tone="warning">{warning}</Notice>}

    {canAdd && (
      <p className="flex items-start gap-1.5 text-xs text-[var(--muted)]">
        <MapPin size={13} className="mt-0.5 shrink-0" />
        Every photo is stamped with the address, the exact coordinates and the time it was taken.
      </p>
    )}

    <p className="flex items-start gap-1.5 text-xs text-[var(--muted)]">
      <ShieldCheck size={13} className="mt-0.5 shrink-0" />
      Photos are deleted automatically {PHOTO_RETENTION_DAYS} days after they are added
      {photos.length ? ` — the oldest here goes in ${daysLeft(photos[0].expiresAt)} days` : ""}.
    </p>

    {full && canAdd && <p className="text-xs font-medium text-amber-700">This visit already holds the maximum of {MAX_PHOTOS_PER_VISIT} photos.</p>}

    {viewing && (
      <Modal title="Visit photo"
        description={`Taken ${new Date(viewing.createdAt).toLocaleString("en-IN")} · removed in ${daysLeft(viewing.expiresAt)} days`}
        onClose={() => setViewing(null)}
        footer={canAdd
          ? <Button tone="danger" className="w-full" busy={busy} onClick={() => remove(viewing)}><Trash2 size={15} />Remove this photo</Button>
          : undefined}>
        {/* Unoptimized: these are private, session-guarded bytes that expire in
            thirty days — running them through the image optimiser would cache
            them somewhere with a different lifetime to the original. */}
        <Image src={`/api/visits/${visitId}/photos/${viewing._id}`} alt="Photo from this visit"
          width={1600} height={1200} unoptimized className="h-auto w-full rounded-[10px]" />

        <PhotoPlace location={viewing.location} />
      </Modal>
    )}
  </Card>;
}

/**
 * The position under the photograph, in text that can be copied and as a link
 * that opens the exact point on a map. The image already carries the same words
 * burnt in; this is the readable, checkable copy of them.
 */
function PhotoPlace({ location }: { location?: PhotoLocation }) {
  if (!location || typeof location.latitude !== "number") {
    return <p className="mt-3 flex items-start gap-1.5 rounded-[10px] bg-[var(--surface-2)] p-3 text-xs text-[var(--muted)]">
      <Crosshair size={13} className="mt-0.5 shrink-0" />
      No location was recorded with this photo.
    </p>;
  }

  const accuracy = formatAccuracy(location.accuracy);
  return <div className="mt-3 space-y-1.5 rounded-[10px] bg-[var(--surface-2)] p-3">
    <p className="flex items-start gap-1.5 text-[13px] font-semibold">
      <MapPin size={14} className="mt-0.5 shrink-0 text-[var(--brand)]" />
      {placeSummary(location)}
    </p>
    <p className="font-mono text-xs text-[var(--ink-2)]">
      Lat {formatLatitude(location.latitude)} · Long {formatLongitude(location.longitude)}
    </p>
    {accuracy && <p className="text-xs text-[var(--muted)]">Accurate to about {accuracy}</p>}
    <a href={mapsPointUrl(location)} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]">
      <Navigation size={13} />Open this spot in Google Maps
    </a>
  </div>;
}
