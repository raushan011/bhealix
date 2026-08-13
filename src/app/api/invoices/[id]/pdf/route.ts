import { connectDb } from "@/lib/db/mongoose";
import { storedBytes } from "@/lib/db/bytes";
import { Invoice } from "@/models/Invoice";
import { BillingSettings } from "@/models/Settings";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel } from "@/constants/access";
import { badRequest, fail, OBJECT_ID } from "@/lib/api";
import { loadSettings } from "@/lib/billing/invoices";
import { pdfFileName, renderInvoicePdf } from "@/lib/billing/pdf";
import type { InvoiceRecord } from "@/lib/billing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bill as a file.
 *
 * Same document and same permissions as the print sheet at
 * `/invoices/[id]/print`, which stays for anybody who wants paper. This one
 * answers with `attachment`, so pressing Download saves a PDF instead of
 * opening a printer dialog and asking the user to save it themselves.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid invoice reference");

    await connectDb();
    const [invoice, settings, qrSettings] = await Promise.all([
      Invoice.findById(id)
        .populate("employee", "name employeeId")
        .populate("payments.receivedBy", "name")
        .lean() as unknown as Promise<(InvoiceRecord & { employee?: { _id?: unknown } | null }) | null>,
      loadSettings(),
      // The QR's bytes are `select: false`, so they are asked for by name here
      // rather than travelling with every other read of the settings document.
      BillingSettings.findOne({ key: "billing" }).select("+paymentQr paymentQrType paymentQrLabel")
        .lean() as unknown as Promise<{ paymentQr?: unknown; paymentQrType?: string; paymentQrLabel?: string } | null>
    ]);
    if (!invoice) return badRequest("Invoice not found", 404);

    // A representative downloads their own bills; desk roles download any.
    const owned = String(invoice.employee?._id ?? "") === auth.session.userId;
    const allowed = usesFieldPanel(auth.session.role) ? owned : can.viewAllBilling(auth.session.role);
    if (!allowed) return badRequest("You do not have access to this invoice", 403);

    const record = JSON.parse(JSON.stringify(invoice)) as InvoiceRecord;
    const bytes = await renderInvoicePdf(record, settings, {
      bytes: storedBytes(qrSettings?.paymentQr),
      type: qrSettings?.paymentQrType,
      label: qrSettings?.paymentQrLabel
    });

    return new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "content-disposition": `attachment; filename="${pdfFileName(record.invoiceNo)}"`,
        // A bill can be edited and a payment recorded against it a minute later.
        "cache-control": "private, no-store"
      }
    });
  } catch (error) {
    return fail(error);
  }
}
