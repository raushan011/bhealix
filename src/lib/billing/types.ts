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
  /** Units supplied free under a scheme. Charged for nothing; still leaves stock. */
  freeQuantity?: number;
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

/**
 * The file evidencing a receipt, as the screens read it. The bytes are fetched
 * from the proof route when somebody actually opens one; this is what the list
 * needs to say the money has been evidenced and by whom.
 */
export type PaymentProofRef = {
  contentType: string;
  bytes: number;
  fileName?: string;
  uploadedAt: string;
  uploadedBy?: { _id: string; name: string } | null;
};

export type InvoicePayment = {
  _id: string;
  amount: number;
  mode: PaymentMode;
  reference?: string;
  paidAt: string;
  receivedBy?: { name: string } | null;
  notes?: string;
  proof?: PaymentProofRef | null;
};

/**
 * One scheduled chase, as the screens read it. `doneAt` is what separates the
 * call still to be made from the one already made — a bill's history of chasing
 * is worth as much as its next date.
 */
export type InvoiceFollowUp = {
  _id: string;
  date: string;
  note?: string;
  doneAt?: string | null;
  createdBy?: { _id: string; name: string } | null;
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
  followUps?: InvoiceFollowUp[];
  /** A mirror of the earliest follow-up still outstanding; the lists sort on it. */
  followUpDate?: string;
  notes?: string;
  terms?: string;
  createdBy?: { name: string } | null;
  cancelledAt?: string;
  cancelReason?: string;
};

/** The lighter row a list returns — no items, no payments, no follow-up detail. */
export type InvoiceListRow = Omit<InvoiceRecord, "items" | "payments" | "taxSummary" | "followUps">;

export type BillingSummary = { billed: number; collected: number; outstanding: number };
