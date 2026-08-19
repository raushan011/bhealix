import { connectDb } from "@/lib/db/mongoose";
import { CustomPayslip } from "@/models/Payroll";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { loadSettings } from "@/lib/billing/invoices";
import { loadPayrollSettings } from "@/lib/hr/payroll-run";
import { blankCustomPayslip, customPayslipSchema, customTotals } from "@/lib/hr/custom-payslip";

/**
 * Payslips written by hand, newest first.
 *
 * `?blank=1` answers with a fresh sheet already carrying the company's name,
 * address, PAN, signatory and footer note, so the editor opens on something
 * that looks like this company's payslip rather than an empty form.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.issueCustomPayslip);
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    if (params.get("blank") === "1") {
      const [company, payroll] = await Promise.all([loadSettings(), loadPayrollSettings()]);
      return ok({
        blank: blankCustomPayslip({
          company, signatoryName: payroll.signatoryName, footerNote: payroll.payslipNote,
          month: params.get("month") ?? undefined
        })
      });
    }

    const filter: Record<string, unknown> = {};
    if (params.get("employee")) filter.employee = params.get("employee");
    if (params.get("status")) filter.status = params.get("status");

    const items = await CustomPayslip.find(filter)
      .select("status employee employeeName title periodLabel month gross totalDeductions netPay createdBy createdAt updatedAt")
      .populate("createdBy", "name").sort({ createdAt: -1 }).limit(200).lean();
    return ok({ items });
  } catch (error) {
    return fail(error);
  }
}

/** Writes a new sheet. Nothing about it is derived: what is sent is what prints. */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.issueCustomPayslip);
    if ("response" in auth) return auth.response;

    const value = customPayslipSchema.parse(await request.json());
    await connectDb();

    const created = await CustomPayslip.create({
      ...value,
      ...customTotals(value),
      createdBy: auth.session.userId,
      updatedBy: auth.session.userId
    });

    await record({
      actor: auth.session.userId, action: "payroll.custom.created", entityType: "CustomPayslip",
      entityId: created._id,
      metadata: { title: value.title, period: value.periodLabel, employee: value.employee ?? null, netPay: created.netPay }
    });

    return ok({ item: created }, 201);
  } catch (error) {
    return fail(error);
  }
}
