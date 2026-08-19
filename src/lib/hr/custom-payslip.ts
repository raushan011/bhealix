import { z } from "zod";
import { formatDate } from "@/lib/time";
import { monthLabel, PAY_MODES, rupees, type NamedAmount } from "./payroll";
import type { PayslipCompany, PayslipCustom, PayslipMeta, PayslipRecord } from "@/components/hr/payslip-document";

/**
 * A payslip written by hand.
 *
 * The monthly run works a payslip out from attendance, a salary record and the
 * statutory rules, and nothing on it can be changed except by changing what it
 * was built from. That is right for the ordinary month and wrong for the cases
 * a company still meets: an arrear paid on its own, a full-and-final settlement,
 * a bonus, a contractor's fee, a slip for somebody who was never on the rolls
 * here, a duplicate reissued with the bank's new name on it, a slip for a period
 * that is not a calendar month at all.
 *
 * So a custom payslip carries every figure and every word on the sheet as
 * data, and the administrator decides all of it. Nothing is derived on read
 * beyond the totals, and even the net can be set by hand where the arithmetic
 * is not the story. Free of Mongoose and React so the editor's live preview,
 * the server's validation and the printed sheet all read one document the same
 * way.
 */

export const CUSTOM_PAYSLIP_STATUSES = ["Draft", "Issued"] as const;
export type CustomPayslipStatus = (typeof CUSTOM_PAYSLIP_STATUSES)[number];

export type DetailLine = { label: string; value: string };

export type CustomPayslipDoc = {
  _id?: string;
  status: CustomPayslipStatus;
  /** Whose slip this is, when it is somebody on the rolls. Purely a link — the sheet reads `details`. */
  employee?: string | null;
  employeeName?: string;

  title: string;
  /** "August 2026", "1–15 September 2026", "Full and final settlement" — whatever the period is. */
  periodLabel: string;
  /** The month it belongs to for the record, when there is one. */
  month?: string;

  company: { name: string; address: string; pan: string };
  /** The employee block, as label–value lines in the order they should print. */
  details: DetailLine[];

  attendance: { show: boolean; daysInMonth: number; divisorDays: number; paidDays: number; lopDays: number };

  earnings: NamedAmount[];
  deductions: NamedAmount[];
  employerContributions: NamedAmount[];
  employerContributionsNote: string;

  /** Whether the net is gross − deductions ± rounding, or a figure set by hand. */
  netPayMode: "computed" | "manual";
  netPayOverride: number;
  roundOff: number;
  showAmountInWords: boolean;

  paymentDate?: string;
  paymentMode?: string;
  reference?: string;
  signatoryName: string;
  /** A line under the totals — an explanation of what this slip is for. */
  note: string;
  /** Replaces the "computer-generated payslip" line when set. */
  footerText: string;
  showDraftMark: boolean;
  /** Printed faintly across the sheet — "DUPLICATE", "COPY". */
  watermark: string;

  gross?: number;
  totalDeductions?: number;
  netPay?: number;
  createdBy?: { _id: string; name: string } | string | null;
  createdAt?: string;
  updatedAt?: string;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID = /^[a-f\d]{24}$/i;

const amountRow = z.object({
  name: z.string().trim().min(1, "Give the line a name").max(60),
  amount: z.number().finite()
});

export const customPayslipSchema = z.object({
  status: z.enum(CUSTOM_PAYSLIP_STATUSES).default("Draft"),
  employee: z.string().regex(OBJECT_ID).nullable().optional(),
  employeeName: z.string().trim().max(120).optional().default(""),

  title: z.string().trim().min(1, "Give the sheet a title").max(60),
  periodLabel: z.string().trim().min(1, "Say what period this slip is for").max(80),
  month: z.string().regex(MONTH, "Give the month as yyyy-mm").optional().or(z.literal("")),

  company: z.object({
    name: z.string().trim().max(120).default(""),
    address: z.string().trim().max(300).default(""),
    pan: z.string().trim().max(20).default("")
  }),
  details: z.array(z.object({
    label: z.string().trim().max(40),
    value: z.string().trim().max(120)
  })).max(24),

  attendance: z.object({
    show: z.boolean().default(true),
    daysInMonth: z.number().min(0).max(366).default(0),
    divisorDays: z.number().min(0).max(366).default(0),
    paidDays: z.number().min(0).max(366).default(0),
    lopDays: z.number().min(0).max(366).default(0)
  }),

  earnings: z.array(amountRow).max(30),
  deductions: z.array(amountRow).max(30),
  employerContributions: z.array(amountRow).max(15),
  employerContributionsNote: z.string().trim().max(160).default(""),

  netPayMode: z.enum(["computed", "manual"]).default("computed"),
  netPayOverride: z.number().finite().default(0),
  roundOff: z.number().finite().default(0),
  showAmountInWords: z.boolean().default(true),

  paymentDate: z.string().regex(DATE).optional().or(z.literal("")),
  paymentMode: z.enum(PAY_MODES).optional().or(z.literal("")),
  reference: z.string().trim().max(120).optional().default(""),
  signatoryName: z.string().trim().max(80).default(""),
  note: z.string().trim().max(600).default(""),
  footerText: z.string().trim().max(400).default(""),
  showDraftMark: z.boolean().default(false),
  watermark: z.string().trim().max(30).default("")
});

export type CustomPayslipInput = z.infer<typeof customPayslipSchema>;

/** The figures a sheet shows under its two columns, from whatever lines it carries. */
export function customTotals(doc: Pick<CustomPayslipDoc, "earnings" | "deductions" | "netPayMode" | "netPayOverride" | "roundOff">) {
  const gross = rupees(doc.earnings.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  const totalDeductions = rupees(doc.deductions.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  const netPayable = gross - totalDeductions;
  const roundOff = doc.netPayMode === "manual" ? 0 : rupees(doc.roundOff);
  const netPay = doc.netPayMode === "manual" ? rupees(doc.netPayOverride) : netPayable + roundOff;
  return { gross, totalDeductions, netPayable, roundOff, netPay };
}

/** A fresh sheet, ready to be filled in. */
export function blankCustomPayslip(seed: {
  company?: PayslipCompany; signatoryName?: string; footerNote?: string; month?: string;
} = {}): CustomPayslipDoc {
  const company = seed.company ?? {};
  const month = seed.month ?? "";
  return {
    status: "Draft",
    employee: null,
    employeeName: "",
    title: "Payslip",
    periodLabel: month ? monthLabel(month) : "",
    month,
    company: {
      name: company.tradeName || company.legalName || "",
      address: companyAddress(company),
      pan: company.pan ?? ""
    },
    details: [
      { label: "Name", value: "" },
      { label: "Employee ID", value: "" },
      { label: "Designation", value: "" },
      { label: "Department", value: "" },
      { label: "Date of joining", value: "" },
      { label: "PAN", value: "" },
      { label: "Bank", value: "" },
      { label: "Account", value: "" }
    ],
    attendance: { show: true, daysInMonth: 0, divisorDays: 0, paidDays: 0, lopDays: 0 },
    earnings: [{ name: "Basic", amount: 0 }, { name: "House rent allowance", amount: 0 }],
    deductions: [],
    employerContributions: [],
    employerContributionsNote: "Paid by the company on your behalf — not deducted from you",
    netPayMode: "computed",
    netPayOverride: 0,
    roundOff: 0,
    showAmountInWords: true,
    paymentDate: "",
    paymentMode: "",
    reference: "",
    signatoryName: seed.signatoryName ?? "",
    note: "",
    footerText: seed.footerNote ?? "",
    showDraftMark: false,
    watermark: ""
  };
}

/**
 * The address on one line. The settings' street line often already ends in the
 * city and PIN, and "Greater Noida, Greater Noida, 201310, 201310" is what
 * joining the four fields blindly prints.
 */
export function companyAddress(company: PayslipCompany): string {
  const parts: string[] = [];
  for (const part of [company.address, company.city, company.state, company.pinCode]) {
    const value = part?.trim();
    if (!value) continue;
    if (parts.some(seen => seen.toLowerCase().includes(value.toLowerCase()))) continue;
    parts.push(value);
  }
  return parts.join(", ");
}

/**
 * The lines an employee record supplies, in the order a payslip usually shows
 * them. Empty values are kept so the administrator sees which the record did
 * not have and can type them in.
 */
export function detailsFromEmployee(who: {
  name?: string; employeeId?: string; designation?: string; department?: string; workLocation?: string;
  joiningDate?: string; exitDate?: string; panNumber?: string; uan?: string; esicNumber?: string;
  bankName?: string; bankAccountNo?: string;
}): DetailLine[] {
  const lastFour = who.bankAccountNo ? who.bankAccountNo.slice(-4) : "";
  return [
    { label: "Name", value: who.name ?? "" },
    { label: "Employee ID", value: who.employeeId ?? "" },
    { label: "Designation", value: who.designation ?? "" },
    { label: "Department", value: who.department ?? "" },
    { label: "Location", value: who.workLocation ?? "" },
    { label: "Date of joining", value: who.joiningDate ? formatDate(who.joiningDate) : "" },
    ...(who.exitDate ? [{ label: "Last working day", value: formatDate(who.exitDate) }] : []),
    { label: "PAN", value: who.panNumber ?? "" },
    { label: "UAN", value: who.uan ?? "" },
    { label: "ESIC number", value: who.esicNumber ?? "" },
    { label: "Bank", value: who.bankName ?? "" },
    { label: "Account", value: lastFour ? `•••• ${lastFour}` : "" }
  ];
}

/**
 * The document, arranged for the sheet. One mapping shared by the editor's
 * preview and the print page, so what is previewed is what prints.
 */
export function customToSheet(doc: CustomPayslipDoc): {
  payslip: PayslipRecord; company: PayslipCompany; meta: PayslipMeta; custom: PayslipCustom;
} {
  const totals = customTotals(doc);
  const attendance = doc.attendance;
  return {
    payslip: {
      month: doc.month || "",
      status: doc.showDraftMark ? "Draft" : "Approved",
      daysInMonth: attendance.daysInMonth,
      divisorDays: attendance.divisorDays,
      onRollDays: attendance.paidDays + attendance.lopDays,
      lopDays: attendance.lopDays,
      paidDays: attendance.paidDays,
      earnings: doc.earnings,
      gross: totals.gross,
      deductions: doc.deductions,
      totalDeductions: totals.totalDeductions,
      employerContributions: doc.employerContributions,
      netPayable: totals.netPayable,
      netPay: totals.netPay,
      roundOff: totals.roundOff,
      note: doc.note || undefined
    },
    company: { tradeName: doc.company.name, address: doc.company.address, pan: doc.company.pan },
    meta: {
      paymentDate: doc.paymentDate || undefined,
      paymentMode: doc.paymentMode || undefined,
      reference: doc.reference || undefined,
      signatoryName: doc.signatoryName || undefined
    },
    custom: {
      title: doc.title,
      periodLabel: doc.periodLabel,
      details: doc.details.filter(line => line.label || line.value),
      showAttendance: attendance.show,
      showAmountInWords: doc.showAmountInWords,
      employerContributionsNote: doc.employerContributionsNote,
      footerText: doc.footerText,
      watermark: doc.watermark
    }
  };
}
