/**
 * Billing vocabulary shared by the forms, the API and the models.
 * Kept free of Mongoose and of React so both sides can import it.
 */

/** A tax invoice charges GST; a bill of supply does not. One flag, two documents. */
export const INVOICE_STATUSES = ["Unpaid", "Partially paid", "Paid", "Cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_MODES = ["Cash", "UPI", "Bank transfer", "Cheque", "Card", "Other"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** A discount is either a percentage of the line or a flat rupee amount off it. */
export const DISCOUNT_TYPES = ["PERCENT", "AMOUNT"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/** The slabs that exist in Indian GST. Anything else is a data-entry mistake. */
export const GST_RATES = [0, 5, 12, 18, 28] as const;

export const UNITS = ["Pcs", "Box", "Strip", "Bottle", "Tube", "Jar", "Sachet", "Kit", "Pack"] as const;

/**
 * Who a bill can be raised against.
 *
 * A doctor comes from the visiting directory and keeps its call times, visits
 * and route plans. Everybody else is a trade buyer kept in its own directory,
 * because a stockist has no call schedule and does not belong on a route.
 */
export const CUSTOMER_TYPES = [
  "Stockist", "Distributor", "Chemist", "Hospital", "Clinic", "Institution", "Individual", "Other"
] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/** How the buyer on a bill was chosen. Stored so a bill can say what it was. */
export const PARTY_SOURCES = ["Doctor", "Customer", "One-off"] as const;
export type PartySource = (typeof PARTY_SOURCES)[number];

/** Every party type a bill can carry, for filters that span both directories. */
export const PARTY_TYPES = ["Doctor", ...CUSTOMER_TYPES] as const;

/**
 * State codes are the first two digits of a GSTIN. The invoice compares the
 * seller's code with the place of supply to decide between CGST+SGST and IGST,
 * so this list is the single source for both the picker and that decision.
 */
export const STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" }
];

export const STATE_CODES = STATES.map(state => state.code);
export const stateName = (code?: string) => STATES.find(state => state.code === code)?.name ?? "";

/** 22AAAAA0000A1Z5 — two digits of state, ten of PAN, then entity, Z, checksum. */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
export const isGstin = (value: string) => GSTIN_PATTERN.test(value.trim().toUpperCase());

/** The state a GSTIN belongs to, so entering one fills the place of supply in. */
export const stateCodeOfGstin = (value: string) =>
  isGstin(value) ? value.trim().slice(0, 2) : "";

export const formatMoney = (amount: number) =>
  `₹${(Math.round(amount * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
