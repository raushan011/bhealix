import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfFileName, renderInvoicePdf } from "./pdf";
import type { SellerSettings } from "./invoices";
import type { InvoiceItem, InvoiceRecord } from "./types";

const settings: SellerSettings = {
  legalName: "Sarthak Enterprises", tradeName: "BHEALIX",
  address: "C 171, Swarn Nagri, Block C, Gautam Budhha Nagar",
  city: "Greater Noida", pinCode: "201310", state: "Uttar Pradesh", stateCode: "09",
  gstin: "09EVYPR9180K2Z4", phone: "9919756487", email: "support@bhealix.com",
  bankName: "HDFC Bank", bankAccountName: "Sarthak Enterprises", bankAccountNo: "50200108611266",
  bankIfsc: "HDFC0000278",
  invoicePrefix: "BHX", defaultPaymentTerms: 30, defaultGstRate: 12,
  ratesIncludeTax: false, terms: "Goods once sold will not be taken back.",
  signatoryName: "Nikita Yugeshwar"
};

function item(overrides: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    name: "Face Wash", unit: "Pcs", hsnCode: "3304", quantity: 5, freeQuantity: 2, rate: 399,
    discountType: "PERCENT", discountValue: 60, gstRate: 12,
    gross: 1995, discount: 1197, taxableValue: 798, cgst: 0, sgst: 0, igst: 0, taxAmount: 0, total: 798,
    ...overrides
  };
}

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    _id: "6a7d8d53369339a824e61b55", invoiceNo: "BHX/2026-27/0005", financialYear: "2026-27",
    taxed: false, status: "Unpaid", interState: false, ratesIncludeTax: false,
    employee: { _id: "e1", name: "Chetan", employeeId: "BHX-MR-02" },
    billTo: {
      name: "Dr Ms khan", clinicName: "Kgn health clinic", type: "Doctor",
      address: "House no 207 gali no 8 mandoli village", city: "Delhi", state: "Uttar Pradesh",
      phone: "7834910177"
    },
    items: [item()], taxSummary: [],
    subtotal: 1995, totalDiscount: 1197, taxableValue: 798,
    cgstTotal: 0, sgstTotal: 0, igstTotal: 0, taxTotal: 0, roundOff: 0, grandTotal: 798,
    payments: [], amountPaid: 0, balanceDue: 798,
    invoiceDate: "2026-08-13T00:00:00.000Z", dueDate: "2026-09-12T00:00:00.000Z",
    ...overrides
  };
}

/** `%PDF-` at the front and `%%EOF` at the back is a file a reader will open. */
function readable(bytes: Uint8Array) {
  const text = Buffer.from(bytes).toString("latin1");
  return text.startsWith("%PDF-") && text.trimEnd().endsWith("%%EOF");
}

describe("the bill as a PDF", () => {
  it("renders a bill of supply as a file a reader will open", async () => {
    const bytes = await renderInvoicePdf(invoice(), settings);
    expect(readable(bytes)).toBe(true);
    expect(bytes.byteLength).toBeGreaterThan(1500);
  });

  /**
   * The standard fonts encode Windows-1252, which has no rupee sign. Left
   * alone, the first money figure on the sheet would throw and the download
   * would fail — every bill, not some of them.
   */
  it("survives the rupee sign, which its font cannot encode", async () => {
    const bytes = await renderInvoicePdf(invoice({
      notes: "Paid ₹500 in cash — balance ₹298 promised on the 15th"
    }), settings);
    expect(readable(bytes)).toBe(true);
  });

  it("renders a tax invoice with its extra columns and summary", async () => {
    const taxed = invoice({
      taxed: true, invoiceNo: "BHX/2026-27/0011",
      items: [item({ cgst: 47.88, sgst: 47.88, taxAmount: 95.76, total: 893.76 })],
      taxSummary: [{ hsnCode: "3304", gstRate: 12, taxableValue: 798, cgst: 47.88, sgst: 47.88, igst: 0 }],
      placeOfSupply: { state: "Uttar Pradesh", code: "09" },
      cgstTotal: 47.88, sgstTotal: 47.88, taxTotal: 95.76, grandTotal: 894, roundOff: 0.24, balanceDue: 894
    });
    expect(readable(await renderInvoicePdf(taxed, settings))).toBe(true);
  });

  it("renders an inter-state bill, whose tax is one column rather than two", async () => {
    const igst = invoice({
      taxed: true, interState: true,
      items: [item({ igst: 95.76, taxAmount: 95.76, total: 893.76 })],
      taxSummary: [{ hsnCode: "3304", gstRate: 12, taxableValue: 798, cgst: 0, sgst: 0, igst: 95.76 }],
      placeOfSupply: { state: "Maharashtra", code: "27" },
      igstTotal: 95.76, taxTotal: 95.76, grandTotal: 894, balanceDue: 894
    });
    expect(readable(await renderInvoicePdf(igst, settings))).toBe(true);
  });

  /** Fifty lines is more than one page; the table has to carry on to the next. */
  it("carries a long bill onto further pages", async () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      item({ name: `Product ${index + 1} with a name long enough to wrap inside its column`, freeQuantity: 0 }));
    const bytes = await renderInvoicePdf(invoice({ items: many }), settings);
    expect(readable(bytes)).toBe(true);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it("renders a cancelled bill and one with receipts against it", async () => {
    const settled = invoice({
      status: "Paid", amountPaid: 798, balanceDue: 0,
      payments: [{
        _id: "p1", amount: 798, mode: "UPI", reference: "UPI/2026/8891",
        paidAt: "2026-08-20T00:00:00.000Z", receivedBy: { name: "Chetan" }
      }]
    });
    expect(readable(await renderInvoicePdf(settled, settings))).toBe(true);
    expect(readable(await renderInvoicePdf(
      invoice({ status: "Cancelled", cancelReason: "Order withdrawn" }), settings))).toBe(true);
  });

  it("leaves out a QR it cannot decode rather than failing the download", async () => {
    const bytes = await renderInvoicePdf(invoice(), settings, {
      bytes: new Uint8Array([1, 2, 3, 4]), type: "image/png", label: "Scan to pay"
    });
    expect(readable(bytes)).toBe(true);
  });
});

describe("naming the file", () => {
  /** BHX/2026-27/0005 is an invoice number and not a path. */
  it("takes the slashes out of an invoice number", () => {
    expect(pdfFileName("BHX/2026-27/0005")).toBe("BHX-2026-27-0005.pdf");
  });

  it("still names a file when the number is unusable", () => {
    expect(pdfFileName("///")).toBe("invoice.pdf");
    expect(pdfFileName("")).toBe("invoice.pdf");
  });
});
