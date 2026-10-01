import { z } from "zod";
import { EMPLOYMENT_STATUSES } from "./payroll";

/**
 * What an employee record and a salary revision accept, in one place.
 *
 * Shared by the three routes that write them — hiring somebody, editing their
 * record, and revising their salary — so that the onboarding form, which does
 * all three at once, cannot accept a value the profile screen would refuse a
 * minute later.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const text = (max = 200) => z.string().trim().max(max).optional();
const day = () => z.string().regex(ISO_DATE).optional().or(z.literal(""));

/** The employment record the HR desk keeps — everything but who they are and how they sign in. */
export const employeeProfileShape = {
  designation: text(),
  department: text(),
  joiningDate: day(),
  reportingTo: z.string().regex(OBJECT_ID).nullable().optional(),
  employmentType: z.enum(["Full time", "Part time", "Contract", "Intern"]).optional(),
  workLocation: text(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
  confirmationDate: day(),
  /** The last working day. Payroll pays up to it and no further. */
  exitDate: day(),
  exitReason: text(300),
  phone: text(40),
  dateOfBirth: day(),
  bloodGroup: text(10),
  address: text(400),
  emergencyContact: z.object({ name: text(120), relation: text(60), phone: text(40) }).optional(),
  panNumber: text(15),
  // Only the last four digits are ever stored — the whole number is not
  // something this application has any reason to hold.
  aadhaarLastFour: z.string().trim().regex(/^\d{4}$/, "Enter the last four digits").optional().or(z.literal("")),
  bankAccountNo: text(40),
  bankIfsc: text(20),
  bankName: text(80),
  /** The provident fund number that follows a person between employers. */
  uan: text(20),
  esicNumber: text(20),
  /**
   * Spelled out rather than built from LEAVE_TYPES with `z.record`: a record
   * keyed by an enum demands every key, so sending only the types being changed
   * would be rejected. Unpaid is absent on purpose — it has no ceiling.
   */
  leaveEntitlement: z.object({
    Casual: z.number().min(0).max(365).optional(),
    Sick: z.number().min(0).max(365).optional(),
    Earned: z.number().min(0).max(365).optional(),
    Compensatory: z.number().min(0).max(365).optional()
  }).optional(),
  notes: text(1000)
};

const amount = z.number().min(0).max(10_000_000);
const namedAmounts = z.array(z.object({ name: z.string().trim().min(1).max(60), amount })).max(12).default([]);

/** One salary revision, from a month forward. */
export const salaryInputSchema = z.object({
  effectiveFrom: z.string().regex(MONTH, "Give the month as yyyy-mm"),
  basic: amount,
  hra: amount.default(0),
  conveyance: amount.default(0),
  medical: amount.default(0),
  special: amount.default(0),
  otherAllowances: namedAmounts,

  pfApplicable: z.boolean().default(true),
  pfOnFullBasic: z.boolean().default(false),
  esiApplicable: z.boolean().default(true),
  professionalTaxApplicable: z.boolean().default(true),
  monthlyTds: amount.default(0),
  recurringDeductions: namedAmounts,
  note: z.string().trim().max(300).optional()
});
export type SalaryInput = z.infer<typeof salaryInputSchema>;
