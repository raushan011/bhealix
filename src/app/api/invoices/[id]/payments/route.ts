import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Invoice } from "@/models/Invoice";
import { PaymentProof } from "@/models/PaymentProof";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { fromDateInput } from "@/lib/time";
import { money } from "@/lib/billing/gst";
import { recalculate } from "@/lib/billing/invoices";
import { PAYMENT_MODES } from "@/lib/billing/constants";

const schema = z.object({
  amount: z.number().positive("Enter the amount received"),
  mode: z.enum(PAYMENT_MODES),
  reference: z.string().trim().max(120).optional(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(300).optional()
});

/**
 * Records money received. An invoice is settled in as many parts as the doctor
 * pays in, so this appends rather than replaces, and the cached totals are
 * recomputed from the whole list every time.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.recordPayment);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid invoice reference");

    await connectDb();
    const invoice = await Invoice.findById(id);
    if (!invoice) return badRequest("Invoice not found", 404);

    // The rep who owns the bill collects against it; the administrator against any.
    const isOwner = String(invoice.employee) === auth.session.userId;
    if (usesFieldPanel(auth.session.role) && !isOwner) {
      return badRequest("You can only record payments against your own bills", 403);
    }
    if (invoice.cancelledAt) return badRequest("This invoice has been cancelled");
    if (invoice.status === "Paid") return badRequest("This invoice is already settled in full");

    const input = schema.parse(await request.json());
    const amount = money(input.amount);
    // Half a rupee of slack, so a doctor rounding up their last payment is not
    // rejected — but a genuine overpayment is caught before it reaches the books.
    if (amount > money(invoice.balanceDue) + 0.5) {
      return badRequest(`Only ₹${invoice.balanceDue.toFixed(2)} is outstanding on this bill`);
    }

    invoice.payments.push({
      amount,
      mode: input.mode,
      reference: input.reference,
      paidAt: input.paidAt ? fromDateInput(input.paidAt) : new Date(),
      // Field staff record what they themselves collected; an administrator
      // records it on behalf of the rep whose bill it is.
      receivedBy: usesFieldPanel(auth.session.role) ? auth.session.userId : invoice.employee,
      recordedBy: auth.session.userId,
      notes: input.notes
    });

    recalculate(invoice);
    await invoice.save();

    // The new receipt's own id goes back with the totals: the form that recorded
    // it may have a screenshot of the transfer waiting to be attached to it, and
    // that upload needs somewhere to go.
    const added = invoice.payments[invoice.payments.length - 1];

    return ok({
      status: invoice.status, amountPaid: invoice.amountPaid, balanceDue: invoice.balanceDue,
      payments: invoice.payments.length, payment: String(added._id)
    }, 201);
  } catch (error) {
    return fail(error);
  }
}

/** Removes a receipt entered by mistake; the balance follows by itself. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageBilling);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    const paymentId = new URL(request.url).searchParams.get("payment") ?? "";
    if (!OBJECT_ID.test(id) || !OBJECT_ID.test(paymentId)) return badRequest("Invalid payment reference");

    await connectDb();
    const invoice = await Invoice.findById(id);
    if (!invoice) return badRequest("Invoice not found", 404);

    const before = invoice.payments.length;
    invoice.payments.pull({ _id: paymentId });
    if (invoice.payments.length === before) return badRequest("Payment not found", 404);

    recalculate(invoice);
    await invoice.save();
    // The proof only ever existed to evidence this receipt. With the receipt
    // gone it has nothing left to point at, so it goes too rather than sitting
    // in the collection unreachable.
    await PaymentProof.deleteOne({ payment: paymentId });
    return ok({ status: invoice.status, amountPaid: invoice.amountPaid, balanceDue: invoice.balanceDue });
  } catch (error) {
    return fail(error);
  }
}
