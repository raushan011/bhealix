import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Invoice } from "@/models/Invoice";
import { StockMovement } from "@/models/Inventory";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel, type Role } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { fromDateInput } from "@/lib/time";
import { loadSettings, recalculate } from "@/lib/billing/invoices";
import { billInputSchema, composeBill, failed, rememberBuyerDetails } from "@/lib/billing/compose";
import { syncInvoiceStock } from "@/lib/inventory/ledger";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const patchSchema = z.object({
  dueDate: z.string().regex(ISO_DATE).nullable().optional(),
  followUpDate: z.string().regex(ISO_DATE).nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
  terms: z.string().trim().max(2000).optional(),
  /**
   * Cancelling keeps the number and the record — a tax invoice is never made to
   * disappear — and puts the goods back on the shelf.
   */
  cancel: z.boolean().optional(),
  cancelReason: z.string().trim().max(300).optional()
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid invoice reference");

    await connectDb();
    const invoice = await Invoice.findById(id)
      .populate("doctor", "name clinicName fullAddress city area pinCode phones gstin state stateCode")
      .populate("customer", "code type name businessName address city pinCode phones gstin state stateCode")
      .populate("employee", "name employeeId email role")
      .populate("payments.receivedBy", "name")
      .populate("createdBy", "name")
      .lean() as unknown as { employee?: { _id?: unknown } | null } | null;
    if (!invoice) return badRequest("Invoice not found", 404);

    // A representative may open their own bills and nobody else's.
    const owner = String((invoice.employee as { _id?: unknown } | null)?._id ?? "");
    if (usesFieldPanel(auth.session.role) && owner !== auth.session.userId) {
      return badRequest("You do not have access to this invoice", 403);
    }
    if (!usesFieldPanel(auth.session.role) && !can.viewAllBilling(auth.session.role)) {
      return badRequest("You do not have access to this action", 403);
    }

    return ok({ invoice });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Rewrites a bill.
 *
 * The number, the series and the date it was raised on are kept — this corrects
 * what a bill says, it does not issue a replacement. Refused once money has
 * been received against it: re-pricing a bill below what has already been paid
 * would leave the books saying something untrue, and the receipts have to come
 * off first.
 *
 * Stock is re-synced from the new lines, which puts the old quantities back and
 * takes the new ones out in a single step.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageBilling);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid invoice reference");

    await connectDb();
    const invoice = await Invoice.findById(id);
    if (!invoice) return badRequest("Invoice not found", 404);
    if (invoice.cancelledAt) return badRequest("This bill has been cancelled and can no longer be changed");
    if (invoice.payments.length) {
      return badRequest("Money has been received against this bill. Remove the receipts first, then edit it.");
    }

    const input = billInputSchema.parse(await request.json());
    const settings = await loadSettings();

    if (input.taxed && !settings.gstin) {
      return badRequest("Add your GSTIN under Billing settings before saving this as a tax invoice, or switch it to a bill of supply.");
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

    // The invoice number and its financial year are deliberately not touched.
    invoice.set(composed.fields);
    invoice.updatedBy = auth.session.userId;

    recalculate(invoice);
    await invoice.save();
    await syncInvoiceStock(invoice);

    if (input.saveDoctorDetails) {
      await rememberBuyerDetails(composed.party, composed.gstin, composed.placeOfSupplyCode);
    }

    return ok({ _id: invoice._id, invoiceNo: invoice.invoiceNo, grandTotal: invoice.grandTotal, status: invoice.status });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageBilling);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid invoice reference");

    await connectDb();
    const invoice = await Invoice.findById(id);
    if (!invoice) return badRequest("Invoice not found", 404);

    const input = patchSchema.parse(await request.json());
    if (invoice.cancelledAt && !input.cancel) return badRequest("This invoice is cancelled and can no longer be changed");

    if (input.dueDate !== undefined) invoice.dueDate = input.dueDate ? fromDateInput(input.dueDate) : undefined;
    if (input.followUpDate !== undefined) invoice.followUpDate = input.followUpDate ? fromDateInput(input.followUpDate) : undefined;
    if (input.notes !== undefined) invoice.notes = input.notes;
    if (input.terms !== undefined) invoice.terms = input.terms;

    if (input.cancel && !invoice.cancelledAt) {
      if (invoice.payments.length) {
        return badRequest("Money has been received against this invoice. Remove the receipts first if it really has to be cancelled.");
      }
      invoice.cancelledAt = new Date();
      invoice.cancelledBy = auth.session.userId;
      invoice.cancelReason = input.cancelReason;
    }

    recalculate(invoice);
    await invoice.save();
    // A cancelled invoice writes no stock rows, which is what returns the goods.
    await syncInvoiceStock(invoice);

    return ok({ invoice: { _id: invoice._id, status: invoice.status } });
  } catch (error) {
    return fail(error);
  }
}

/**
 * The correction path for a bill raised in error, before anything has been paid
 * against it. Its stock rows go with it. A bill that has been settled is
 * cancelled rather than deleted, so the numbering keeps no gaps it cannot explain.
 */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageBilling);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid invoice reference");

    await connectDb();
    const invoice = await Invoice.findById(id).select("payments invoiceNo").lean() as
      { payments?: unknown[]; invoiceNo: string } | null;
    if (!invoice) return badRequest("Invoice not found", 404);
    if (invoice.payments?.length) {
      return badRequest("Money has been received against this invoice. Cancel it instead of deleting it.");
    }

    await StockMovement.deleteMany({ invoice: id });
    await Invoice.findByIdAndDelete(id);
    return ok({ deleted: true, invoiceNo: invoice.invoiceNo });
  } catch (error) {
    return fail(error);
  }
}
