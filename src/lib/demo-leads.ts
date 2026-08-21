import { z } from "zod";

/**
 * A company that pressed "Book a demo".
 *
 * The product's own pipeline, as distinct from everything else in the app,
 * which is the *customer's* pipeline. A request arrives from the public site
 * with no account behind it, lands in the super administrator's control room,
 * and is worked there — rung, shown the product, sent a proposal, won or lost.
 * Pure here: the model, the two routes and the screen all import from this file.
 */

export const DEMO_LEAD_STATUSES = ["New", "Contacted", "Demo booked", "Proposal sent", "Won", "Lost"] as const;
export type DemoLeadStatus = (typeof DEMO_LEAD_STATUSES)[number];

export function demoLeadTone(status: string): "neutral" | "info" | "brand" | "warn" | "success" | "danger" {
  switch (status) {
    case "Contacted": return "info";
    case "Demo booked": return "brand";
    case "Proposal sent": return "warn";
    case "Won": return "success";
    case "Lost": return "danger";
    default: return "neutral";
  }
}

/** What the form asks them to tick — the pillars of the pitch, plus the open door. */
export const DEMO_INTERESTS = [
  "Field force & doctor visits",
  "Online sales & affiliates",
  "Shipping & order processing",
  "GST billing & inventory",
  "HR & payroll",
  "Custom development or integration"
] as const;

export const TEAM_SIZES = ["1–10", "11–50", "51–200", "200+"] as const;

const phone = z.string().trim().min(6, "Enter a phone number we can reach you on").max(20);

/** What the public form may send. Nothing here is trusted past this schema. */
export const demoRequestSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  company: z.string().trim().min(2, "Enter your company's name").max(120),
  email: z.email("Enter a valid email address").max(120),
  phone,
  role: z.string().trim().max(80).optional().or(z.literal("")),
  teamSize: z.enum(TEAM_SIZES).optional().or(z.literal("")),
  interests: z.array(z.enum(DEMO_INTERESTS)).max(DEMO_INTERESTS.length).default([]),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  /**
   * A field people never see and robots always fill. A submission that fills
   * it is accepted with a smile and thrown away, which tells the robot nothing.
   */
  website: z.string().max(200).optional().or(z.literal(""))
});

export type DemoRequestInput = z.infer<typeof demoRequestSchema>;

/** What the control room may change about a request once it is in. */
export const demoLeadUpdateSchema = z.object({
  status: z.enum(DEMO_LEAD_STATUSES).optional(),
  notes: z.string().trim().max(4000).optional()
}).refine(input => Object.keys(input).length > 0, "Nothing to change");
