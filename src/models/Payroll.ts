import { Schema, model, models } from "mongoose";
import { DEFAULT_PT_SLABS, EMPLOYMENT_STATUSES, LOP_BASES, PAY_MODES, PAYROLL_STATUSES } from "@/lib/hr/payroll";
import { CUSTOM_PAYSLIP_STATUSES } from "@/lib/hr/custom-payslip";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const NamedAmountSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  amount: { type: Number, required: true, default: 0 }
}, { _id: false });

/**
 * What one person is paid, from a date forward.
 *
 * Effective-dated rather than edited in place. A raise in July must not change
 * what June's payslip says, and an employee who asks in December what they were
 * earning in March is owed an answer. Each revision is its own document, and
 * the one in force for a month is the latest whose `effectiveFrom` is not after
 * it — so the whole salary history is the collection itself, with nothing to
 * reconstruct.
 */
const SalaryStructureSchema = new Schema({
  employee: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  /** "yyyy-mm". Payroll is a monthly matter; a mid-month raise takes effect the following month. */
  effectiveFrom: { type: String, required: true, match: MONTH },

  basic: { type: Number, required: true, min: 0, default: 0 },
  hra: { type: Number, min: 0, default: 0 },
  conveyance: { type: Number, min: 0, default: 0 },
  medical: { type: Number, min: 0, default: 0 },
  special: { type: Number, min: 0, default: 0 },
  otherAllowances: { type: [NamedAmountSchema], default: [] },

  pfApplicable: { type: Boolean, default: true },
  pfOnFullBasic: { type: Boolean, default: false },
  esiApplicable: { type: Boolean, default: true },
  professionalTaxApplicable: { type: Boolean, default: true },
  monthlyTds: { type: Number, min: 0, default: 0 },
  recurringDeductions: { type: [NamedAmountSchema], default: [] },

  /** Why it changed — an annual revision, a promotion, a correction. */
  note: String,
  createdBy: { type: Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

// Revising the same month twice corrects that revision rather than leaving two
// competing versions of it in force.
SalaryStructureSchema.index({ employee: 1, effectiveFrom: -1 }, { unique: true });

export const SalaryStructure = models.SalaryStructure ?? model("SalaryStructure", SalaryStructureSchema);

/**
 * One month's payroll for the whole company.
 *
 * A run exists so that a month is processed once, as a unit, and so that
 * "approved" means something. While it is a draft it can be regenerated freely
 * — attendance is still being corrected, a joiner is still being added. Once it
 * is approved the figures are what the company has committed to, and the
 * payslips under it are never recomputed.
 */
const PayrollRunSchema = new Schema({
  month: { type: String, required: true, unique: true, match: MONTH, index: true },
  status: { type: String, enum: PAYROLL_STATUSES, default: "Draft", index: true },
  /** Frozen onto the run, so a later change of policy cannot restate an old month. */
  lopBasis: { type: String, enum: LOP_BASES, required: true },
  /**
   * Whether the fund applied when this month was worked out. Frozen for the
   * same reason as the basis above, and read back to tell an open draft that
   * the rules have moved on under it.
   */
  pfEnabled: { type: Boolean, default: false },

  totals: {
    employees: { type: Number, default: 0 },
    gross: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    netPay: { type: Number, default: 0 },
    employerCost: { type: Number, default: 0 }
  },

  /**
   * Everybody the run could not pay, and why. Recorded rather than silently
   * omitted: a payroll that quietly leaves somebody out is how a person misses
   * a month's salary and nobody finds out until they say so.
   */
  skipped: {
    type: [new Schema({
      employee: { type: Schema.Types.ObjectId, ref: "User" },
      name: String,
      employeeId: String,
      reason: { type: String, required: true }
    }, { _id: false })],
    default: []
  },

  generatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  generatedAt: Date,
  approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  approvedAt: Date,
  paidBy: { type: Schema.Types.ObjectId, ref: "User" },
  paidAt: Date,
  paymentDate: String,
  paymentMode: { type: String, enum: PAY_MODES },
  reference: String,
  note: String
}, { timestamps: true });

export const PayrollRun = models.PayrollRun ?? model("PayrollRun", PayrollRunSchema);

/**
 * One person's payslip for one month, as a settled document.
 *
 * Every figure is stored rather than derived on read, and so is the employee's
 * own detail — name, designation, bank account, PAN. A payslip is evidence
 * given to somebody who may present it to a bank or a landlord two years later,
 * and it must still say what it said on the day it was issued even after a
 * transfer, a raise, a change of account or a change of name.
 */
const PayslipSchema = new Schema({
  run: { type: Schema.Types.ObjectId, ref: "PayrollRun", required: true, index: true },
  month: { type: String, required: true, match: MONTH, index: true },
  employee: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  status: { type: String, enum: PAYROLL_STATUSES, default: "Draft", index: true },

  /** The employment record as it stood when the slip was issued. */
  snapshot: {
    name: String,
    employeeId: String,
    designation: String,
    department: String,
    workLocation: String,
    joiningDate: String,
    exitDate: String,
    employmentStatus: { type: String, enum: EMPLOYMENT_STATUSES },
    panNumber: String,
    uan: String,
    esicNumber: String,
    /** Only the last four digits are shown on a payslip, so only those are kept here. */
    bankAccountLastFour: String,
    bankName: String
  },

  daysInMonth: { type: Number, required: true },
  divisorDays: { type: Number, required: true },
  onRollDays: { type: Number, required: true },
  lopDays: { type: Number, default: 0 },
  paidDays: { type: Number, required: true },

  earnings: { type: [NamedAmountSchema], default: [] },
  gross: { type: Number, default: 0 },
  deductions: { type: [NamedAmountSchema], default: [] },
  totalDeductions: { type: Number, default: 0 },
  employerContributions: { type: [NamedAmountSchema], default: [] },
  costToCompany: { type: Number, default: 0 },

  netPayable: { type: Number, default: 0 },
  netPay: { type: Number, default: 0 },
  roundOff: { type: Number, default: 0 },
  pfWages: { type: Number, default: 0 },
  esiWages: { type: Number, default: 0 },

  /** What the salary was on paper, so a short month explains itself. */
  fullGross: { type: Number, default: 0 },
  note: String
}, { timestamps: true });

// One payslip per person per month, whatever route it was created by.
PayslipSchema.index({ month: 1, employee: 1 }, { unique: true });
PayslipSchema.index({ employee: 1, month: -1 });

export const Payslip = models.Payslip ?? model("Payslip", PayslipSchema);

/**
 * How this company runs its payroll. One document, like the billing settings
 * next door, because a professional tax slab or a pay day changes at the HR
 * desk and not in a deployment.
 */
const PayrollSettingsSchema = new Schema({
  key: { type: String, default: "payroll", unique: true, index: true },

  lopBasis: { type: String, enum: LOP_BASES, default: "Calendar days" },
  /**
   * Whether the company operates a provident fund at all. Off by default: a
   * fund is registered for and opted into, and no payroll should start
   * withholding 12% of a basic because nobody said not to.
   */
  pfEnabled: { type: Boolean, default: false },
  /** The state's professional tax slabs, held as data because state budgets change them. */
  ptSlabs: { type: [new Schema({ upTo: { type: Number, default: null }, amount: { type: Number, default: 0 } }, { _id: false })],
    default: () => DEFAULT_PT_SLABS },
  ptStateName: { type: String, default: "Karnataka" },
  /** Where a state meets its annual ceiling with a larger February charge. */
  ptFebruaryAmount: { type: Number, default: null },

  /** The day of the month salaries are ordinarily paid, for the run to propose. */
  payDay: { type: Number, min: 1, max: 31, default: 7 },
  defaultPayMode: { type: String, enum: PAY_MODES, default: "Bank transfer" },
  signatoryName: String,
  payslipNote: String
}, { timestamps: true });

export const PayrollSettings = models.PayrollSettings ?? model("PayrollSettings", PayrollSettingsSchema);

const DetailLineSchema = new Schema({
  label: { type: String, trim: true, maxlength: 40, default: "" },
  value: { type: String, trim: true, maxlength: 120, default: "" }
}, { _id: false });

/**
 * A payslip written by hand — see `lib/hr/custom-payslip.ts`.
 *
 * Kept apart from `Payslip` on purpose. That collection is what the monthly run
 * wrote and what the run's totals are counted from; a slip an administrator
 * typed for an arrear, a settlement or a bonus must not be mistaken for a month
 * that was worked out from attendance, and must not be recounted into one.
 * Every word and every figure on the sheet is stored, so it prints the same
 * for as long as it exists.
 */
const CustomPayslipSchema = new Schema({
  status: { type: String, enum: CUSTOM_PAYSLIP_STATUSES, default: "Draft", index: true },
  employee: { type: Schema.Types.ObjectId, ref: "User", index: true, default: null },
  employeeName: { type: String, trim: true, default: "" },

  title: { type: String, required: true, trim: true, maxlength: 60 },
  periodLabel: { type: String, required: true, trim: true, maxlength: 80 },
  month: { type: String, match: MONTH, index: true },

  company: {
    name: { type: String, default: "" },
    address: { type: String, default: "" },
    pan: { type: String, default: "" }
  },
  details: { type: [DetailLineSchema], default: [] },

  attendance: {
    show: { type: Boolean, default: true },
    daysInMonth: { type: Number, default: 0 },
    divisorDays: { type: Number, default: 0 },
    paidDays: { type: Number, default: 0 },
    lopDays: { type: Number, default: 0 }
  },

  earnings: { type: [NamedAmountSchema], default: [] },
  deductions: { type: [NamedAmountSchema], default: [] },
  employerContributions: { type: [NamedAmountSchema], default: [] },
  employerContributionsNote: { type: String, default: "" },

  netPayMode: { type: String, enum: ["computed", "manual"], default: "computed" },
  netPayOverride: { type: Number, default: 0 },
  roundOff: { type: Number, default: 0 },
  showAmountInWords: { type: Boolean, default: true },

  paymentDate: String,
  paymentMode: { type: String, enum: [...PAY_MODES, ""] },
  reference: String,
  signatoryName: { type: String, default: "" },
  note: { type: String, default: "" },
  footerText: { type: String, default: "" },
  showDraftMark: { type: Boolean, default: false },
  watermark: { type: String, default: "" },

  /** Worked out on save from the lines above, so the list can show a total without reading every sheet. */
  gross: { type: Number, default: 0 },
  totalDeductions: { type: Number, default: 0 },
  netPay: { type: Number, default: 0 },

  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

CustomPayslipSchema.index({ createdAt: -1 });

export const CustomPayslip = models.CustomPayslip ?? model("CustomPayslip", CustomPayslipSchema);
