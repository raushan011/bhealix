"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Camera, Crosshair, ImageIcon, Loader2, MapPin, Navigation, RefreshCw, ShieldCheck, Trash2
} from "lucide-react";
import { Button, Card, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { daysLeft, MAX_PHOTOS_PER_VISIT, PHOTO_RETENTION_DAYS } from "@/lib/visits";
import {
  formatAccuracy, formatLatitude, formatLongitude, mapsPointUrl, placeLabel, stampLines,
  type Fix, type PlaceName
} from "@/lib/geo";
import { FIX_MESSAGE, requestFix } from "@/lib/geo-fix";

export type PhotoLocation = Fix & PlaceName;
export type VisitPhoto = {
  _id: string; createdAt: string; expiresAt: string; caption?: string; location?: PhotoLocation;
};

/** Longest edge kept. A clinic board, a visiting card and a shelf all read clearly at this. */
const MAX_EDGE = 1600;
const QUALITY = 0.72;

/** Past this the rep has moved on, and the fix is worth taking again before uploading. */
const FIX_STALE_MS = 3 * 60_000;

/**
 * The area and street address for a fix. Resolved on the server, where the Maps
 * key lives; anything that goes wrong leaves the coordinates to speak for
 * themselves rather than stopping the photo. The coordinates are what prove
 * where the rep stood — the wording only makes them readable.
 */
async function placeNameFor(fix: Fix): Promise<PlaceName> {
  try {
    const response = await fetch(`/api/google/reverse?lat=${fix.latitude}&lng=${fix.longitude}`);
    if (!response.ok) return {};
    const json = await response.json() as { data?: PlaceName };
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

/** Where a photo was taken, named the way the stamp on it names the place. */
const placeSummary = (location?: PhotoLocation | null) =>
  location && typeof location.latitude === "number" ? placeLabel(location, location) : "";

const isLocated = (photo: VisitPhoto) => typeof photo.location?.latitude === "number";

/** A fix, the place it resolved to, and when it was taken. */
type Located = { fix: Fix; place: PlaceName; at: number };

export function VisitPhotos({ visitId, initial, canAdd }: {
  visitId: string; initial: VisitPhoto[]; canAdd: boolean;
}) {
  const [photos, setPhotos] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [located, setLocated] = useState<Located | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [viewing, setViewing] = useState<VisitPhoto | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  /**
   * The photo a retake is replacing. Held in a ref rather than state because it
   * is read inside the file input's change handler, which fires after the
   * camera closes — the tap that set it is long over by then.
   */
  const replacing = useRef<VisitPhoto | null>(null);

  const full = photos.length >= MAX_PHOTOS_PER_VISIT;

  /**
   * Finds where the rep is, ahead of them needing it.
   *
   * Started as soon as the card appears rather than when the camera button is
   * pressed, for two reasons that both bite on a phone.
   *
   * A fix in a clinic can take twenty seconds — the permission prompt runs on
   * the same clock, and indoors the first answer often comes from the network
   * rather than GPS. Made to wait for that after tapping the button, a rep
   * concludes the app is broken. Started on arrival, it is nearly always ready
   * before they are.
   *
   * And a file input has to be opened inside the tap that asked for it. Opening
   * it after an await spends the browser's user-gesture, and on a phone the
   * camera then simply never appears — no error, no camera, nothing.
   */
  const findLocation = useCallback(async () => {
    setLocating(true); setLocationError("");
    const result = await requestFix();
    if (!result.fix) {
      setLocated(null);
      setLocationError(FIX_MESSAGE[result.reason]);
      setLocating(false);
      return;
    }
    setLocated({ fix: result.fix, place: await placeNameFor(result.fix), at: Date.now() });
    setLocating(false);
  }, []);

  useEffect(() => { if (canAdd && !full) findLocation(); }, [canAdd, full, findLocation]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (!located) { setError("Your location has not been found yet, so a photo cannot be stamped."); return; }

    setBusy(true); setError("");
    try {
      const room = MAX_PHOTOS_PER_VISIT - photos.length + (replacing.current ? 1 : 0);
      const chosen = Array.from(files).slice(0, room);

      // Taken again if the rep has been standing here a while — a fix from
      // three minutes ago may be the last clinic rather than this one. If it
      // cannot be refreshed the one in hand still stamps the photo, which is
      // far better than losing the shot they have just taken.
      let current = located;
      if (Date.now() - located.at > FIX_STALE_MS) {
        setStage("Checking your location…");
        const again = await requestFix();
        if (again.fix) {
          current = { fix: again.fix, place: await placeNameFor(again.fix), at: Date.now() };
          setLocated(current);
        }
      }

      const { fix, place } = current;
      const lines = stampLines({ fix, place, takenAt: new Date() });

      setStage("Stamping the location on…");
      const body = new FormData();
      for (const file of chosen) {
        const blob = await prepare(file, lines);
        body.append("photo", blob, file.name.replace(/\.[^.]+$/, "") + ".jpg");
      }
      body.append("latitude", String(fix.latitude));
      body.append("longitude", String(fix.longitude));
      if (fix.accuracy !== undefined) body.append("accuracy", String(fix.accuracy));
      if (place.address) body.append("address", place.address);
      if (place.area) body.append("area", place.area);
      if (place.city) body.append("city", place.city);

      setStage("Uploading…");
      const response = await fetch(`/api/visits/${visitId}/photos`, { method: "POST", body });
      const json = await response.json() as { error?: string; data?: { items: VisitPhoto[] } };
      if (!response.ok) throw new Error(json.error ?? "Could not upload that photo");
      const added = json.data?.items ?? [];

      // A retake: the old photo goes only once the new one is safely up, so a
      // failed upload never leaves the visit with fewer photos than it had.
      const old = replacing.current;
      replacing.current = null;
      if (old) {
        setStage("Removing the old photo…");
        await fetch(`/api/visits/${visitId}/photos/${old._id}`, { method: "DELETE" });
        setPhotos(current => [...current.filter(item => item._id !== old._id), ...added]);
        setViewing(null);
      } else {
        setPhotos(current => [...current, ...added]);
      }

      if (chosen.length < files.length) {
        setError(`Only ${room} more photo${room === 1 ? "" : "s"} could be added to this visit.`);
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not upload that photo");
    } finally {
      setBusy(false);
      setStage("");
      replacing.current = null;
      // Cleared so choosing the same file twice still fires a change event.
      if (camera.current) camera.current.value = "";
      if (gallery.current) gallery.current.value = "";
    }
  }

  /**
   * Takes a photo again in place of this one. The camera has to open inside
   * the tap, so the photo being replaced is noted first and dealt with once
   * the new one has uploaded. Nothing else changes about the upload — the new
   * photo is stamped with where the rep is now, like any other.
   */
  function retake(photo: VisitPhoto) {
    if (!located) { setError("Your location has not been found yet, so a photo cannot be stamped."); setViewing(null); return; }
    replacing.current = photo;
    camera.current?.click();
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
    </div>

    {canAdd && <>
      {/* Two inputs rather than one. `capture` is what makes a phone open the
          camera instead of offering a choice — which is right for the shot
          being taken now, and wrong for the one already in the gallery, taken
          minutes ago at the same clinic. A single input can only do one. */}
      <input ref={camera} type="file" accept="image/*" capture="environment" multiple className="hidden"
        onChange={event => upload(event.target.files)} />
      <input ref={gallery} type="file" accept="image/*" multiple className="hidden"
        onChange={event => upload(event.target.files)} />

      <div className="grid grid-cols-2 gap-2">
        {/* No await between the tap and the click: a file input has to open
            inside the gesture that asked for it, or a phone quietly ignores it.
            That is why the location is found ahead of time rather than here. */}
        <Button tone="secondary" className="text-sm" busy={busy} disabled={full || !located}
          onClick={() => camera.current?.click()}>
          <Camera size={15} />Take a photo
        </Button>
        <Button tone="secondary" className="text-sm" busy={busy} disabled={full || !located}
          onClick={() => gallery.current?.click()}>
          <ImageIcon size={15} />From gallery
        </Button>
      </div>

      <LocationStrip located={located} locating={locating} error={locationError} onRetry={findLocation} />
    </>}

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
              isLocated(photo) ? "bg-[var(--media-chip)] text-[var(--media-chip-ink)]" : "bg-black/60 text-white/80"
            }`} title={isLocated(photo) ? placeSummary(photo.location) : "No location"}>
              {isLocated(photo) ? <MapPin size={11} /> : <Crosshair size={11} />}
            </span>
          </button>
        ))}
      </div>
    )}

    {!photos.length && !canAdd && <p className="text-sm text-[var(--muted)]">No photos were attached to this visit.</p>}

    {error && <Notice tone="error">{error}</Notice>}

    {canAdd && (
      <p className="flex items-start gap-1.5 text-xs text-[var(--muted)]">
        <MapPin size={13} className="mt-0.5 shrink-0" />
        Every photo is stamped with where you are now — the area, the exact coordinates and the time — whether it is
        taken here or picked from the gallery.
      </p>
    )}

    <p className="flex items-start gap-1.5 text-xs text-[var(--muted)]">
      <ShieldCheck size={13} className="mt-0.5 shrink-0" />
      Photos are deleted automatically {PHOTO_RETENTION_DAYS} days after they are added
      {photos.length ? ` — the oldest here goes in ${daysLeft(photos[0].expiresAt)} days` : ""}.
    </p>

    {full && canAdd && <p className="text-xs font-medium text-[var(--warn-ink)]">This visit already holds the maximum of {MAX_PHOTOS_PER_VISIT} photos.</p>}

    {viewing && (
      <Modal title="Visit photo"
        description={`Taken ${new Date(viewing.createdAt).toLocaleString("en-IN")} · removed in ${daysLeft(viewing.expiresAt)} days`}
        onClose={() => setViewing(null)}
        footer={canAdd
          ? <div className="grid grid-cols-2 gap-2">
              <Button tone="secondary" busy={busy} disabled={!located} onClick={() => retake(viewing)}><Camera size={15} />Retake</Button>
              <Button tone="danger" busy={busy} onClick={() => remove(viewing)}><Trash2 size={15} />Remove</Button>
            </div>
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
 * Where the rep is, said out loud before a photo is taken.
 *
 * Somebody who can see "Koramangala, Bengaluru · ±12 m" knows the stamp will be
 * right, and somebody who can see it still looking knows to wait rather than
 * concluding the buttons are broken. When it fails, the message says which of
 * the several different failures it was, and offers the only thing worth
 * offering: another go.
 */
function LocationStrip({ located, locating, error, onRetry }: {
  located: Located | null; locating: boolean; error: string; onRetry: () => void;
}) {
  if (locating) {
    return <p className="flex items-center gap-1.5 rounded-[10px] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)]">
      <Loader2 size={13} className="shrink-0 animate-spin" />Finding your location…
    </p>;
  }

  if (!located) {
    return <div className="rounded-[10px] border border-[var(--warn-line)] bg-[var(--warn-bg)] p-3">
      <p className="flex items-start gap-1.5 text-xs font-medium text-[var(--warn-ink)]">
        <Crosshair size={13} className="mt-0.5 shrink-0" />
        {error || "Your location has not been found yet."}
      </p>
      <button onClick={onRetry}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--warn-ink)] underline">
        <RefreshCw size={12} />Try again
      </button>
    </div>;
  }

  const accuracy = formatAccuracy(located.fix.accuracy);
  return <p className="flex items-start gap-1.5 rounded-[10px] bg-[var(--ok-bg)] px-3 py-2 text-xs text-[var(--ok-ink)]">
    <MapPin size={13} className="mt-0.5 shrink-0" />
    <span className="min-w-0">
      <span className="font-semibold">{placeLabel(located.place, located.fix)}</span>
      {accuracy ? ` · ${accuracy}` : ""}
      <button onClick={onRetry} className="ml-1.5 font-semibold underline">Refresh</button>
    </span>
  </p>;
}

/**
 * The position under the photograph, in text that can be copied and as a link
 * that opens the exact point on a map. The image already carries the same words
 * burnt in; this is the readable, checkable copy of them.
 */
function PhotoPlace({ location }: { location?: PhotoLocation }) {
  if (!location || typeof location.latitude !== "number") {
    // Only a photo taken before the location became compulsory can reach this.
    return <p className="mt-3 flex items-start gap-1.5 rounded-[10px] bg-[var(--surface-2)] p-3 text-xs text-[var(--muted)]">
      <Crosshair size={13} className="mt-0.5 shrink-0" />
      No location was recorded with this photo.
    </p>;
  }

  const accuracy = formatAccuracy(location.accuracy);
  const address = location.address?.trim();
  const label = placeSummary(location);

  return <div className="mt-3 space-y-1.5 rounded-[10px] bg-[var(--surface-2)] p-3">
    <p className="flex items-start gap-1.5 text-[13px] font-semibold">
      <MapPin size={14} className="mt-0.5 shrink-0 text-[var(--brand)]" />
      {label}
    </p>
    {address && address !== label && <p className="text-xs text-[var(--ink-2)]">{address}</p>}
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
