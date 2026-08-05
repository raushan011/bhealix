import type { DiscountType, InvoiceStatus, PartySource, PaymentMode } from "./constants";

/**
 * The shapes the billing screens read. Declared here rather than in a route so
 * the browser can name them without importing a module that reaches for the
 * database.
 */

export type InvoiceItem = {
  name: string;
  hsnCode?: string;
  unit?: string;
  quantity: number;
  rate: number;
  discountType: DiscountType;
  discountValue: number;
  gstRate: number;
  gross: number;
  discount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxAmount: number;
  total: number;
};

export type InvoicePayment = {
  _id: string;
  amount: number;
  mode: PaymentMode;
  reference?: string;
  paidAt: string;
  receivedBy?: { name: string } | null;
  notes?: string;
};

export type PartyDetails = {
  name?: string; clinicName?: string; address?: string;
  city?: string; state?: string; stateCode?: string;
  pinCode?: string; gstin?: string; phone?: string;
  /** "Doctor", "Stockist", "Distributor", "Individual"… */
  type?: string;
};

export type InvoiceRecord = {
  _id: string;
  invoiceNo: string;
  financialYear: string;
  taxed: boolean;
  status: InvoiceStatus;
  /** At most one of these; a one-off sale has neither and lives in `billTo`. */
  doctor?: { _id: string; name: string; clinicName?: string; phones?: string[] } | null;
  customer?: { _id: string; code?: string; name: string; businessName?: string; type?: string } | null;
  partySource?: PartySource;
  /** What kind of buyer this bill was raised for. */
  partyType?: string;
  employee?: { _id: string; name: string; employeeId?: string } | null;
  billTo: PartyDetails;
  placeOfSupply?: { state?: string; code?: string };
  interState: boolean;
  ratesIncludeTax: boolean;
  items: InvoiceItem[];
  taxSummary: Array<{ hsnCode?: string; gstRate: number; taxableValue: number; cgst: number; sgst: number; igst: number }>;
  subtotal: number;
  totalDiscount: number;
  taxableValue: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxTotal: number;
  roundOff: number;
  grandTotal: number;
  payments: InvoicePayment[];
  amountPaid: number;
  balanceDue: number;
  invoiceDate: string;
  dueDate?: string;
  paymentTerms?: number;
  followUpDate?: string;
  notes?: string;
  terms?: string;
  createdBy?: { name: string } | null;
  cancelledAt?: string;
  cancelReason?: string;
};

/** The lighter row a list returns — no items, no payments. */
export type InvoiceListRow = Omit<InvoiceRecord, "items" | "payments" | "taxSummary">;

export type BillingSummary = { billed: number; collected: number; outstanding: number };
