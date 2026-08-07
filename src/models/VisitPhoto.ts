import { Schema, model, models } from "mongoose";
import { PHOTO_TYPES } from "@/lib/visits";

/**
 * A photograph a representative took at a call.
 *
 * Held in its own collection rather than on the visit, for two reasons. The
 * bytes would otherwise be dragged into every route that reads a visit — the
 * day's list, the admin report, the plan screen — none of which want them. And
 * a photo has its own lifetime: it goes thirty days after upload while the
 * visit it belongs to stays for good, which a field on the visit could not
 * express.
 *
 * `data` is deliberately `select: false`. Listing photos, counting them and
 * showing them on a page all need the metadata and none of the bytes, so the
 * bytes are fetched only by the one route that serves a single image.
 */
const VisitPhotoSchema = new Schema({
  visit: { type: Schema.Types.ObjectId, ref: "Visit", required: true, index: true },
  doctor: { type: Schema.Types.ObjectId, ref: "Doctor", index: true },
  employee: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

  data: { type: Buffer, required: true, select: false },
  contentType: { type: String, enum: PHOTO_TYPES, required: true },
  bytes: { type: Number, required: true },
  caption: { type: String, maxlength: 200 },

  /**
   * Where the phone was when the photo was taken, and the address that pair of
   * coordinates resolved to. The same words are burnt across the bottom of the
   * image before it is uploaded, so the picture and this record say the same
   * thing — but the picture can be cropped and this cannot, and only this can
   * be searched or read back into a map link.
   *
   * Absent on a photo taken with location switched off, and on every photo
   * taken before this field existed. Both must keep displaying, so nothing here
   * is required and the screens treat a missing fix as a stated fact rather
   * than an empty space.
   */
  location: {
    latitude: Number,
    longitude: Number,
    accuracy: Number,
    address: String,
    area: String,
    city: String
  },

  /** Set at upload to thirty days out. The TTL index below acts on this. */
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

/**
 * The automatic deletion, and the only thing performing it. MongoDB's TTL
 * monitor removes a document once `expiresAt` is in the past — no cron job to
 * schedule, nothing to remember to run, and it keeps working whether or not the
 * application is up.
 */
VisitPhotoSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
VisitPhotoSchema.index({ visit: 1, createdAt: 1 });
VisitPhotoSchema.index({ employee: 1, createdAt: -1 });

export const VisitPhoto = models.VisitPhoto ?? model("VisitPhoto", VisitPhotoSchema);
