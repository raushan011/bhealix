import { Types, type FilterQuery } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { Invoice } from "@/models/Invoice";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel, type Role } from "@/constants/access";
import { badRequest, fail, ok, pageParams, OBJECT_ID } from "@/lib/api";
import { fromDateInput } from "@/lib/time";
import { loadSettings, nextInvoiceNumber, recalculate } from "@/lib/billing/invoices";
import { billInputSchema, composeBill, failed, rememberBuyerDetails } from "@/lib/billing/compose";
import { INVOICE_STATUSES } from "@/lib/billing/constants";
import { syncInvoiceStock } from "@/lib/inventory/ledger";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip, q } = pageParams(request.url);
    const params = new URL(request.url).searchParams;
    const filter: FilterQuery<Record<string, unknown>> = {};

    /*
     * References go in as real ObjectIds, not as the strings they arrive as.
     * `find()` would cast them, but the summary below reuses this same filter
     * inside an aggregation — and `$match` does no casting, so a string id
     * matches nothing and the totals come back silently zero.
     */
    if (usesFieldPanel(auth.session.role)) {
      // A representative sees the bills raised in their own name and no others.
      filter.employee = new Types.ObjectId(auth.session.userId);
    } else {
      if (!can.viewAllBilling(auth.session.role)) return badRequest("You do not have access to this action", 403);
      const employee = params.get("employee");
      if (employee && OBJECT_ID.test(employee)) filter.employee = new Types.ObjectId(employee);
    }

    const doctor = params.get("doctor");
    if (doctor && OBJECT_ID.test(doctor)) filter.doctor = new Types.ObjectId(doctor);
    const customer = params.get("customer");
    if (customer && OBJECT_ID.test(customer)) filter.customer = new Types.ObjectId(customer);
    // "Every stockist", "every doctor" — one control across both directories.
    const partyType = params.get("partyType");
    if (partyType) filter.partyType = partyType;

    const status = params.get("status");
    if (status && (INVOICE_STATUSES as readonly string[]).includes(status)) filter.status = status;

    if (q) {
      const term = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      filter.$or = [{ invoiceNo: term }, { "billTo.name": term }, { "billTo.clinicName": term }];
    }

    const from = params.get("from"), to = params.get("to");
    if ((from && ISO_DATE.test(from)) || (to && ISO_DATE.test(to))) {
      filter.invoiceDate = {
        ...(from && ISO_DATE.test(from) ? { $gte: new Date(`${from}T00:00:00`) } : {}),
        ...(to && ISO_DATE.test(to) ? { $lte: new Date(`${to}T23:59:59`) } : {})
      };
    }

    // "Owed" and "overdue" are shorthands for a status range, so an explicit
    // status on the same request wins rather than being silently overwritten.
    const owing = { $in: ["Unpaid", "Partially paid"] };
    if (params.get("overdue") === "1") {
      if (!filter.status) filter.status = owing;
      filter.dueDate = { $lt: new Date() };
    } else if (params.get("due") === "1" && !filter.status) {
      filter.status = owing;
    }

    const [items, total, summary] = await Promise.all([
      Invoice.find(filter)
        .select("-items -taxSummary -payments")
        .populate("doctor", "name clinicName city area phones")
        .populate("customer", "code name businessName type city phones")
        .populate("employee", "name employeeId")
        .sort({ invoiceDate: -1, createdAt: -1 })
        .skip(skip).limit(limit).lean(),
      Invoice.countDocuments(filter),
      /*
       * Totals for the whole filtered set, not just the page on screen.
       *
       * The cancelled exclusion is folded into `$and` rather than written as a
       * second `status` key: a literal `status` here would overwrite the one
       * the status dropdown and the overdue tick put in the filter, and the
       * cards would quietly total every bill while the count beside them showed
       * the filtered few.
       */
      Invoice.aggregate<{ _id: null; billed: number; collected: number; outstanding: number }>([
        { $match: { $and: [filter, { status: { $ne: "Cancelled" } }] } },
        { $group: {
          _id: null,
          billed: { $sum: "$grandTotal" },
          collected: { $sum: "$amountPaid" },
          outstanding: { $sum: "$balanceDue" }
        } }
      ])
    ]);

    return ok({
      items, total, page, pages: Math.max(1, Math.ceil(total / limit)),
      summary: summary[0] ?? { billed: 0, collected: 0, outstanding: 0 }
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Raises a bill.
 *
 * Everything that turns the request into figures lives in `composeBill`, which
 * editing uses too — so a corrected bill and a new one are always priced by the
 * same code.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageBilling);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = billInputSchema.parse(await request.json());
    const settings = await loadSettings();

    // A tax invoice that cannot name its seller or their state is not a valid
    // document, and the state is what decides CGST + SGST against IGST.
    if (input.taxed && !settings.gstin) {
      return badRequest("Add your GSTIN under Billing settings before raising a tax invoice, or switch this bill to a bill of supply.");
    }
    if (input.taxed && !settings.stateCode) {
      return badRequest("Set your own state under Billing settings — it decides whether a bill carries CGST and SGST or IGST.");
    }

    const employee = await User.findById(input.employee).select("name role active").lean() as
      { name: string; role: Role; active: boolean } | null;
    if (!employee) return badRequest("Representative not found", 404);
    if (!usesFieldPanel(employee.role)) return badRequest("A bill belongs to a medical representative or a sales executive");
    if (!employee.active) return badRequest(`${employee.name} is deactivated`);

    const composed = await composeBill(input, settings);
    if (failed(composed)) return badRequest(composed.error, composed.status);

    const { invoiceNo, year } = await nextInvoiceNumber(settings.invoicePrefix, fromDateInput(input.invoiceDate));
    const grandTotal = Number(composed.fields.grandTotal) || 0;

    const invoice = new Invoice({
      ...composed.fields,
      invoiceNo,
      financialYear: year,
      createdBy: auth.session.userId,
      // Only ever what was actually handed over. The form asks for this as an
      // explicit choice rather than a tick-box, because a tick-box that
      // pre-filled the full amount was marking bills paid that were not.
      payments: input.payment
        ? [{
            amount: Math.min(input.payment.amount, grandTotal),
            mode: input.payment.mode,
            reference: input.payment.reference,
            paidAt: input.payment.paidAt ? fromDateInput(input.payment.paidAt) : fromDateInput(input.invoiceDate),
            receivedBy: input.employee,
            recordedBy: auth.session.userId
          }]
        : []
    });

    recalculate(invoice);
    await invoice.save();
    // Billed goods leave the shelf. Written after the invoice so a failed save
    // never takes stock out for a bill that does not exist.
    await syncInvoiceStock(invoice);

    if (input.saveDoctorDetails) {
      await rememberBuyerDetails(composed.party, composed.gstin, composed.placeOfSupplyCode);
    }

    return ok({ _id: invoice._id, invoiceNo: invoice.invoiceNo, grandTotal: invoice.grandTotal, status: invoice.status }, 201);
  } catch (error) {
    return fail(error);
  }
}
