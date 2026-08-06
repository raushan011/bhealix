"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Camera, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Card, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { daysLeft, MAX_PHOTOS_PER_VISIT, PHOTO_RETENTION_DAYS } from "@/lib/visits";

export type VisitPhoto = { _id: string; createdAt: string; expiresAt: string; caption?: string };

/** Longest edge kept. A clinic board, a visiting card and a shelf all read clearly at this. */
const MAX_EDGE = 1600;
const QUALITY = 0.72;

/**
 * Shrinks a camera photo before it leaves the phone.
 *
 * A rep is usually on mobile data in a corridor, and a modern phone camera
 * produces four or five megabytes of detail nobody will ever look at. Doing
 * this here rather than on the server means the slow part — the upload — is the
 * part that gets smaller. If the browser cannot do it the original is sent
 * unchanged; the server's ceiling still applies.
 */
async function shrink(file: File): Promise<Blob> {
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
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    // A photo already smaller than what we would produce is left alone.
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export function VisitPhotos({ visitId, initial, canAdd }: {
  visitId: string; initial: VisitPhoto[]; canAdd: boolean;
}) {
  const [photos, setPhotos] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<VisitPhoto | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const full = photos.length >= MAX_PHOTOS_PER_VISIT;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError("");
    try {
      const room = MAX_PHOTOS_PER_VISIT - photos.length;
      const chosen = Array.from(files).slice(0, room);
      const body = new FormData();
      for (const file of chosen) {
        const blob = await shrink(file);
        body.append("photo", blob, file.name.replace(/\.[^.]+$/, "") + ".jpg");
      }

      const response = await fetch(`/api/visits/${visitId}/photos`, { method: "POST", body });
      const json = await response.json() as { error?: string; data?: { items: VisitPhoto[] } };
      if (!response.ok) throw new Error(json.error ?? "Could not upload that photo");
      setPhotos(current => [...current, ...(json.data?.items ?? [])]);
      if (chosen.length < files.length) {
        setError(`Only ${room} more photo${room === 1 ? "" : "s"} could be added to this visit.`);
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not upload that photo");
    } finally {
      setBusy(false);
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

    {photos.length > 0 && (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map(photo => (
          <button key={photo._id} type="button" onClick={() => setViewing(photo)}
            className="relative aspect-square overflow-hidden rounded-[10px] border border-[var(--line-2)] bg-[var(--surface-2)]">
            <Image src={`/api/visits/${visitId}/photos/${photo._id}`} alt="Photo from this visit"
              fill unoptimized sizes="120px" className="object-cover" />
          </button>
        ))}
      </div>
    )}

    {!photos.length && !canAdd && <p className="text-sm text-[var(--muted)]">No photos were attached to this visit.</p>}

    {error && <Notice tone="error">{error}</Notice>}

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
      </Modal>
    )}
  </Card>;
}
