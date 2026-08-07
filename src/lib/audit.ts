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
  "payroll.approved": "Approved a payroll month",
  "payroll.reopened": "Reopened a payroll month",
  "payroll.paid": "Marked payroll paid",
  "payroll.deleted": "Deleted a draft payroll month",
  "payroll.settings.updated": "Changed the payroll settings"
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
