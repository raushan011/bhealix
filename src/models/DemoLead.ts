import { Schema, model, models } from "mongoose";
import { DEMO_INTERESTS, DEMO_LEAD_STATUSES, TEAM_SIZES } from "@/lib/demo-leads";

/**
 * A demo request from the public site — see `lib/demo-leads.ts`.
 *
 * Its own collection rather than a row in `SalesLead`: that collection is the
 * customer's prospecting list and is read by every Sales CRM screen, and a
 * company asking to buy the product must never surface in a customer's
 * WhatsApp queue.
 */
const DemoLeadSchema = new Schema({
  name: { type: String, required: true, trim: true },
  company: { type: String, required: true, trim: true, index: true },
  email: { type: String, required: true, trim: true, lowercase: true, index: true },
  phone: { type: String, required: true, trim: true },
  role: { type: String, trim: true },
  teamSize: { type: String, enum: TEAM_SIZES },
  interests: { type: [String], enum: DEMO_INTERESTS, default: [] },
  message: { type: String, trim: true },

  status: { type: String, enum: DEMO_LEAD_STATUSES, default: "New", index: true },
  /** The control room's running note — what was said, what was promised. */
  notes: { type: String, trim: true },
  /** Where the request came from, for when there is more than one form. */
  source: { type: String, default: "website" },
  /** The first hop of the caller's address, kept only to spot a flood. */
  ip: String,
  userAgent: String
}, { timestamps: true });

DemoLeadSchema.index({ status: 1, createdAt: -1 });

export const DemoLead = models.DemoLead ?? model("DemoLead", DemoLeadSchema);
