/**
 * Visit vocabulary shared by the client form and the server model. Kept out of
 * the Mongoose file so client bundles never pull in the database layer.
 */
export const VISIT_OUTCOMES = [
  "Met doctor",
  "Met assistant only",
  "Doctor unavailable",
  "Clinic closed",
  "Asked to come later",
  "Wrong address"
] as const;

export const INTEREST_LEVELS = ["High", "Medium", "Low", "Not interested"] as const;

export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];
export type InterestLevel = (typeof INTEREST_LEVELS)[number];
