import { AuditEvent } from "@/models/Catalog";

/**
 * The trail an administrator reads to see what a representative actually did:
 * every doctor added, every call time corrected, every visit closed and every
 * photo attached, in the order it happened.
 *
 * Kept as its own record rather than inferred from the documents themselves,
 * because the documents only ever show their latest state. A doctor whose call
 * time was corrected three times looks exactly like one corrected once.
 */
export const AUDIT_ACTIONS = {
  "doctor.created": "Added a doctor",
  "doctor.call-schedule.updated": "Corrected a call time",
  "visit.registered": "Registered an unplanned visit",
  "visit.checked-in": "Checked in at a clinic",
  "visit.completed": "Completed a visit",
  "visit.missed": "Marked a visit missed",
  "visit.photo.added": "Attached a photo",
  "visit.photo.deleted": "Removed a photo",

  /**
   * Money received, and the evidence for it. A receipt whose proof appeared and
   * then quietly changed is precisely the thing an audit asks about, so both
   * halves leave a line naming who did it.
   */
  "invoice.payment.proof.added": "Attached proof of a payment",
  "invoice.payment.proof.removed": "Removed proof of a payment",
  "billing.qr.updated": "Updated the payment QR",
  "billing.qr.removed": "Removed the payment QR",

  // Payroll. Every one of these moves money or decides what somebody is paid,
  // so each leaves a line naming who did it — that is the whole point of a
  // trail on this part of the system.
  "salary.revised": "Set a salary",
  "salary.revision.deleted": "Removed a salary revision",
  "payroll.generated": "Prepared a payroll month",
  "payroll.payslip.prepared": "Prepared one employee's payslip",
  "payroll.approved": "Approved a payroll month",
  "payroll.reopened": "Reopened a payroll month",
  "payroll.paid": "Marked payroll paid",
  "payroll.deleted": "Deleted a draft payroll month",
  "payroll.settings.updated": "Changed the payroll settings",

  /**
   * The affiliate scheme. A coupon code decides whose commission an order
   * becomes, and a delivery override decides whether it pays at all — both are
   * ways to direct money at a person without raising an invoice, so both leave
   * a line. The payout run's own lifecycle follows payroll's for the same reason.
   */
  "sales.rep.created": "Added a sales rep",
  "sales.rep.updated": "Updated a sales rep",
  "sales.rep.deactivated": "Deactivated a sales rep",
  "sales.rep.deleted": "Deleted a sales rep",

  /**
   * Self-service. A stranger can now create their own record and mint their own
   * coupon, which is the first time anything in this system has let somebody
   * outside the company direct money at themselves. Every step of it leaves a
   * line — the application, the decision taken on it, and each code issued —
   * because "who approved this person, and when" is the question that follows
   * the first disputed payout.
   */
  "sales.rep.registered": "Applied to join as an affiliate",
  "sales.rep.approved": "Approved an affiliate",
  "sales.rep.rejected": "Turned down an affiliate application",
  "sales.rep.suspended": "Suspended an affiliate",
  "sales.rep.reinstated": "Reinstated an affiliate",
  "sales.rep.profile.updated": "An affiliate updated their own details",
  "sales.rep.password.changed": "An affiliate changed their own password",
  /**
   * Somebody at the company setting an affiliate's password for them, which is
   * the only answer to "what is their password" that a hashed credential
   * allows. It leaves a line because it is a takeover of an account that can be
   * paid money — the new password is read down a telephone and the trail is the
   * only record that the change was deliberate.
   */
  "sales.rep.password.reset": "Reset an affiliate's password",
  "sales.coupon.generated": "An affiliate created their own coupon code",
  "sales.coupon.provisioned": "Created a coupon's discount in Shopify",
  "sales.coupon.setup.failed": "Could not create a coupon's discount in Shopify",
  "sales.coupon.withdrawn": "Withdrew a coupon code",
  "sales.delivery.overridden": "Corrected an order's delivery state by hand",
  /**
   * Booking parcels with the courier. It spends money — freight is charged to
   * the Shiprocket account the moment an airway bill is assigned — and it is the
   * one action here that reaches out and changes something at another company,
   * where it cannot be undone by editing a record.
   */
  "sales.orders.processed": "Booked orders with the courier",
  "sales.synced": "Pulled orders and delivery status",
  "sales.settings.updated": "Changed the affiliate settings",
  "sales.payout.generated": "Prepared an affiliate payout run",
  "sales.payout.adjusted": "Adjusted a rep's payout line",
  "sales.payout.approved": "Approved an affiliate payout run",
  "sales.payout.reopened": "Reopened an affiliate payout run",
  "sales.payout.paid": "Marked an affiliate payout paid",
  "sales.payout.deleted": "Deleted a draft affiliate payout run",

  /**
   * Lead prospecting. Searching Google is billed and saving writes a batch, so
   * both leave a line — "who ran up two thousand requests last Tuesday" is a
   * question a quota bill eventually asks.
   */
  "sales.leads.saved": "Saved leads from a search",
  "sales.lead.updated": "Updated a lead",
  "sales.lead.deleted": "Removed a lead",

  /**
   * Outreach. The message line carries the wording verbatim rather than the
   * template's name, because the template it came from is editable and a
   * parlour asking "who sent me this" wants the sentence they were actually
   * sent, not whatever that template says today.
   */
  "sales.lead.messaged": "Messaged a lead on WhatsApp",
  "sales.template.created": "Wrote an outreach message",
  "sales.template.updated": "Edited an outreach message",
  "sales.template.deleted": "Deleted an outreach message"
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const auditLabel = (action: string) =>
  AUDIT_ACTIONS[action as AuditAction] ?? action;

/**
 * Writes one line of the trail.
 *
 * Swallows its own failures on purpose. The trail records work that has already
 * happened and been saved; a rep standing in a clinic corridor must never lose
 * a completed visit because writing its audit line went wrong.
 */
export async function record(event: {
  actor: string;
  action: AuditAction;
  entityType: string;
  entityId: unknown;
  metadata?: Record<string, unknown>;
}) {
  try {
    await AuditEvent.create(event);
  } catch (error) {
    console.error("Could not write audit event", event.action, error);
  }
}

/**
 * The same line, written by an affiliate acting on their own account.
 *
 * A separate function rather than an optional field on `record`, so a caller
 * physically cannot pass a `SalesRep` id where a `User` id belongs — which
 * would resolve to nothing on every screen that reads the trail, and look like
 * an action nobody took.
 */
export async function recordByRep(event: {
  rep: string;
  action: AuditAction;
  entityType: string;
  entityId: unknown;
  metadata?: Record<string, unknown>;
}) {
  const { rep, ...rest } = event;
  try {
    await AuditEvent.create({ ...rest, actorRep: rep });
  } catch (error) {
    console.error("Could not write audit event", event.action, error);
  }
}
