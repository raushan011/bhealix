/** Projection shared by every doctor list view, so cards never miss a field. */
export const DOCTOR_LIST_FIELDS =
  "code name specialties clinicName phones email fullAddress area city pinCode state stateCode gstin location callSchedule priority stage status assignedTo lastVisitedAt googleMapsUrl";

/**
 * One entry in the directory's location filter, as /api/doctors/locations
 * returns it. Declared here rather than in the route so the browser can name
 * the shape without importing a module that reaches for the database.
 */
export type DoctorLocation = { name: string; total: number; missingCallTime: number };
