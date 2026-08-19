import { amountInWords } from "@/lib/billing/gst";
import { formatDate } from "@/lib/time";
import { monthLabel, type PayrollStatus } from "@/lib/hr/payroll";

/**
 * The payslip as it prints.
 *
 * Plain elements and a fixed palette, like the invoice next door: this sheet
 * has to survive a black-and-white laser printer and a PDF opened on a phone,
 * where the app's cream background and brand colour are only noise. Sizes are
 * in millimetres so an A4 page comes out at A4.
 *
 * Everything shown comes from the payslip document itself, never from the
 * employee record as it stands today. Somebody may present this two years later
 * after a transfer, a raise and a change of bank, and it must still say what it
 * said on the day it was issued.
 */

export type PayslipRecord = {
  _id?: unknown;
  month: string;
  status: PayrollStatus;
  snapshot?: {
    name?: string; employeeId?: string; designation?: string; department?: string;
    workLocation?: string; joiningDate?: string; exitDate?: string; employmentStatus?: string;
    panNumber?: string; uan?: string; esicNumber?: string;
    bankAccountLastFour?: string; bankName?: string;
  };
  daysInMonth: number;
  divisorDays: number;
  onRollDays: number;
  lopDays: number;
  paidDays: number;
  earnings: Array<{ name: string; amount: number }>;
  gross: number;
  deductions: Array<{ name: string; amount: number }>;
  totalDeductions: number;
  employerContributions?: Array<{ name: string; amount: number }>;
  costToCompany?: number;
  netPayable: number;
  netPay: number;
  roundOff: number;
  fullGross?: number;
  note?: string;
};

export type PayslipCompany = {
  legalName?: string; tradeName?: string; address?: string; city?: string;
  state?: string; pinCode?: string; phone?: string; email?: string; pan?: string;
};

export type PayslipMeta = {
  paymentDate?: string; paymentMode?: string; reference?: string; signatoryName?: string; note?: string;
};

/**
 * What a hand-written payslip may say differently from a computed one.
 *
 * Every field is optional and the sheet reads the same as before when none is
 * given: the monthly run's payslips are untouched by this. When `details` is
 * supplied it replaces the employee block wholesale, so a slip for somebody who
 * was never on the rolls can still carry whatever lines the administrator wants
 * on it.
 */
export type PayslipCustom = {
  title?: string;
  periodLabel?: string;
  details?: Array<{ label: string; value: string }>;
  showAttendance?: boolean;
  showAmountInWords?: boolean;
  employerContributionsNote?: string;
  /** Replaces the "computer-generated payslip" line when set. */
  footerText?: string;
  /** Printed faintly across the sheet — "DUPLICATE", "COPY". */
  watermark?: string;
};

const cell = "border border-neutral-400 px-2 py-1 align-top";
const rupee = (amount: number) =>
  `${amount < 0 ? "-" : ""}₹${Math.abs(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null;
  return <div className="flex gap-1 text-[11px] leading-snug">
    <span className="w-[26mm] shrink-0 text-neutral-600 sm:w-[34mm]">{label}</span>
    <span className="min-w-0 font-semibold">{value}</span>
  </div>;
}

export function PayslipDocument({ payslip, company, meta, custom }: {
  payslip: PayslipRecord; company: PayslipCompany; meta?: PayslipMeta; custom?: PayslipCustom;
}) {
  const who = payslip.snapshot ?? {};
  const employer = company.tradeName || company.legalName || "";
  const rows = Math.max(payslip.earnings.length, payslip.deductions.length);
  const prorated = payslip.paidDays < payslip.divisorDays;
  const showAttendance = custom?.showAttendance ?? true;
  const showWords = custom?.showAmountInWords ?? true;
  const details = custom?.details;
  // The hand-written block splits down the middle, like the computed one does.
  const half = details ? Math.ceil(details.length / 2) : 0;
  const leftDetails = details?.slice(0, half) ?? [];
  const rightDetails = details?.slice(half) ?? [];

  /*
   * A 10mm margin is right on paper and wrong on a 360px phone, where it eats a
   * fifth of the screen before the sheet has drawn anything. The screen gets a
   * smaller inset and paper gets its margin back at the width an A4 page needs.
   */
  return <article className="payslip-sheet relative mx-auto w-full max-w-[210mm] bg-white p-4 text-neutral-900 shadow-sm sm:p-[10mm] print:max-w-none print:p-0 print:shadow-none">
    {custom?.watermark && (
      <p aria-hidden className="pointer-events-none absolute inset-0 grid select-none place-items-center overflow-hidden text-[64px] font-black uppercase tracking-[0.3em] text-neutral-900/[0.07] [transform:rotate(-24deg)]">
        {custom.watermark}
      </p>
    )}
    <header className="border border-neutral-400 px-3 py-2 text-center">
      <h1 className="text-[14px] font-bold uppercase tracking-[0.15em]">{employer}</h1>
      {(company.address || company.city) && (
        <p className="mt-0.5 text-[10px] leading-snug text-neutral-700">
          {[company.address, company.city, company.state, company.pinCode].filter(Boolean).join(", ")}
        </p>
      )}
      <p className="mt-1 text-[12px] font-bold uppercase tracking-[0.2em]">
        {custom?.title ?? "Payslip"}{" "}
        {custom?.periodLabel !== undefined
          ? (custom.periodLabel ? `for ${custom.periodLabel}` : "")
          : `for ${monthLabel(payslip.month)}`}
      </p>
      {/* An unapproved slip must never be mistaken for one. */}
      {payslip.status === "Draft" && (
        <p className="mt-1 inline-block border border-red-600 px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-red-600">
          Draft — not yet approved
        </p>
      )}
    </header>

    {/* One column on a phone. Side by side, each half was about 150px wide and
        the 34mm label left roughly nothing for the value beside it. */}
    {details ? (
      (details.length > 0 || showAttendance) && (
        <section className="mt-2 flex flex-wrap border border-neutral-400">
          <div className="min-w-0 basis-full space-y-0.5 border-b border-neutral-400 p-2.5 sm:flex-1 sm:basis-0 sm:border-b-0 sm:border-r">
            {leftDetails.map((line, index) => <Detail key={index} label={line.label} value={line.value} />)}
          </div>
          <div className="min-w-0 basis-full space-y-0.5 p-2.5 sm:flex-1 sm:basis-0">
            {rightDetails.map((line, index) => <Detail key={index} label={line.label} value={line.value} />)}
            {showAttendance && <>
              {payslip.daysInMonth > 0 && <Detail label="Days in month" value={payslip.daysInMonth} />}
              {payslip.divisorDays > 0 && <Detail label="Paid days" value={`${payslip.paidDays} of ${payslip.divisorDays}`} />}
              {payslip.lopDays > 0 && <Detail label="Loss of pay" value={`${payslip.lopDays} day${payslip.lopDays === 1 ? "" : "s"}`} />}
            </>}
          </div>
        </section>
      )
    ) : (
    <section className="mt-2 flex flex-wrap border border-neutral-400">
      <div className="min-w-0 basis-full space-y-0.5 border-b border-neutral-400 p-2.5 sm:flex-1 sm:basis-0 sm:border-b-0 sm:border-r">
        <Detail label="Name" value={who.name} />
        <Detail label="Employee ID" value={who.employeeId} />
        <Detail label="Designation" value={who.designation} />
        <Detail label="Department" value={who.department} />
        <Detail label="Location" value={who.workLocation} />
        <Detail label="Date of joining" value={who.joiningDate ? formatDate(who.joiningDate) : undefined} />
        <Detail label="Last working day" value={who.exitDate ? formatDate(who.exitDate) : undefined} />
      </div>
      <div className="min-w-0 basis-full space-y-0.5 p-2.5 sm:flex-1 sm:basis-0">
        <Detail label="PAN" value={who.panNumber} />
        <Detail label="UAN" value={who.uan} />
        <Detail label="ESIC number" value={who.esicNumber} />
        <Detail label="Bank" value={who.bankName} />
        {/* Only the last four digits, because a payslip gets handed around. */}
        <Detail label="Account" value={who.bankAccountLastFour ? `•••• ${who.bankAccountLastFour}` : undefined} />
        <Detail label="Days in month" value={payslip.daysInMonth} />
        <Detail label="Paid days" value={`${payslip.paidDays} of ${payslip.divisorDays}`} />
        {payslip.lopDays > 0 && <Detail label="Loss of pay" value={`${payslip.lopDays} day${payslip.lopDays === 1 ? "" : "s"}`} />}
      </div>
    </section>
    )}

    {/* Earnings and deductions side by side need about 520px between the four
        columns. On a phone the pair scrolls rather than forcing the sheet wider
        than the screen; on paper there is room and the wrapper does nothing. */}
    <div className="mt-2 overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[480px] border-collapse text-[11px] print:min-w-0">
        <thead>
          <tr className="bg-neutral-100">
            <th className={`${cell} text-left font-bold uppercase tracking-wider`}>Earnings</th>
            <th className={`${cell} w-[28mm] text-right font-bold uppercase tracking-wider`}>Amount</th>
            <th className={`${cell} text-left font-bold uppercase tracking-wider`}>Deductions</th>
            <th className={`${cell} w-[28mm] text-right font-bold uppercase tracking-wider`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, index) => {
            const earning = payslip.earnings[index];
            const deduction = payslip.deductions[index];
            return <tr key={index}>
              <td className={cell}>{earning?.name ?? ""}</td>
              <td className={`${cell} text-right tabular-nums`}>{earning ? rupee(earning.amount) : ""}</td>
              <td className={cell}>{deduction?.name ?? ""}</td>
              <td className={`${cell} text-right tabular-nums`}>{deduction ? rupee(deduction.amount) : ""}</td>
            </tr>;
          })}
          <tr className="bg-neutral-100 font-bold">
            <td className={cell}>Gross earnings</td>
            <td className={`${cell} text-right tabular-nums`}>{rupee(payslip.gross)}</td>
            <td className={cell}>Total deductions</td>
            <td className={`${cell} text-right tabular-nums`}>{rupee(payslip.totalDeductions)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <section className="mt-2 border border-neutral-400">
      {payslip.roundOff !== 0 && (
        <div className="flex justify-between border-b border-neutral-400 px-3 py-1 text-[11px]">
          <span>Rounding</span>
          <span className="tabular-nums">{rupee(payslip.roundOff)}</span>
        </div>
      )}
      <div className="flex items-baseline justify-between bg-neutral-100 px-3 py-2">
        <span className="text-[12px] font-bold uppercase tracking-wider">Net pay</span>
        <span className="text-[15px] font-bold tabular-nums">{rupee(payslip.netPay)}</span>
      </div>
      {showWords && (
        <p className="border-t border-neutral-400 px-3 py-1.5 text-[11px] font-semibold">
          {amountInWords(payslip.netPay)}
        </p>
      )}
    </section>

    {prorated && payslip.fullGross ? (
      <p className="mt-1.5 text-[10px] text-neutral-600">
        Paid for {payslip.paidDays} of {payslip.divisorDays} days. A full month at this salary is {rupee(payslip.fullGross)}.
      </p>
    ) : null}

    {Boolean(payslip.employerContributions?.length) && (
      <section className="mt-2 border border-neutral-400">
        <p className="border-b border-neutral-400 bg-neutral-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider">
          {custom?.employerContributionsNote || "Paid by the company on your behalf — not deducted from you"}
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 px-3 py-2 text-[11px]">
          {payslip.employerContributions!.map(row => (
            <span key={row.name} className="text-neutral-700">
              {row.name} <span className="font-semibold tabular-nums text-neutral-900">{rupee(row.amount)}</span>
            </span>
          ))}
          {payslip.costToCompany ? (
            <span className="text-neutral-700">Cost to company{" "}
              <span className="font-semibold tabular-nums text-neutral-900">{rupee(payslip.costToCompany)}</span>
            </span>
          ) : null}
        </div>
      </section>
    )}

    <footer className="mt-3 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-[110mm] text-[10px] leading-relaxed text-neutral-600">
        {meta?.paymentDate && (
          <p>
            Paid on {formatDate(meta.paymentDate)}
            {meta.paymentMode ? ` by ${meta.paymentMode.toLowerCase()}` : ""}
            {meta.reference ? ` · ${meta.reference}` : ""}.
          </p>
        )}
        {payslip.note && <p>{payslip.note}</p>}
        {meta?.note && <p>{meta.note}</p>}
        <p className="mt-1">
          {custom?.footerText || "This is a computer-generated payslip and is valid without a signature."}
          {company.pan ? ` Employer PAN ${company.pan}.` : ""}
        </p>
      </div>
      {meta?.signatoryName && (
        <div className="text-center text-[10px]">
          <div className="h-[14mm]" />
          <p className="border-t border-neutral-400 px-6 pt-1 font-semibold">{meta.signatoryName}</p>
          <p className="text-neutral-600">For {employer}</p>
        </div>
      )}
    </footer>
  </article>;
}
