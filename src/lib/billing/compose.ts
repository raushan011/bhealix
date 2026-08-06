import { z } from "zod";
import { Doctor } from "@/models/Doctor";
import { Customer } from "@/models/Customer";
import { Product } from "@/models/Catalog";
import { OBJECT_ID } from "@/lib/api";
import { fromDateInput } from "@/lib/time";
import { computeInvoice } from "./gst";
import { DISCOUNT_TYPES, PARTY_SOURCES, PAYMENT_MODES, stateName, STATE_CODES } from "./constants";
import type { SellerSettings } from "./invoices";

/**
 * What a bill is made of, and how it is priced.
 *
 * Shared by raising a bill and by editing one. Two copies of this would be two
 * chances for the figures on a corrected bill to stop matching the figures on a
 * new one, which is precisely the sort of drift a billing system cannot afford.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateField = z.string().regex(ISO_DATE, "Enter a valid date");

const itemSchema = z.object({
  product: z.string().regex(OBJECT_ID).optional(),
  name: z.string().trim().min(1, "Choose a product"),
  hsnCode: z.string().trim().max(20).optional(),
  unit: z.string().trim().max(20).optional(),
  quantity: z.number().positive("Quantity must be more than zero"),
  rate: z.number().min(0, "Rate cannot be negative"),
  discountType: z.enum(DISCOUNT_TYPES).default("PERCENT"),
  discountValue: z.number().min(0, "Discount cannot be negative").default(0),
  gstRate: z.number().min(0).max(50).default(0)
});

export const billInputSchema = z.object({
  /**
   * Exactly one buyer. A doctor from the visiting directory, a trade buyer from
   * the customer directory, or neither for a one-off sale that types its own
   * name and is never billed again.
   */
  partySource: z.enum(PARTY_SOURCES).default("Doctor"),
  doctor: z.string().regex(OBJECT_ID).optional(),
  customer: z.string().regex(OBJECT_ID).optional(),

  employee: z.string().regex(OBJECT_ID, "Choose the representative this bill belongs to"),
  /** A tax invoice charges GST; a bill of supply does not. */
  taxed: z.boolean().default(true),
  ratesIncludeTax: z.boolean().default(false),

  invoiceDate: dateField,
  dueDate: dateField.optional(),
  paymentTerms: z.number().int().min(0).max(365).default(0),
  followUpDate: dateField.optional(),

  placeOfSupplyCode: z.enum(STATE_CODES as [string, ...string[]]).optional(),
  billTo: z.object({
    /** Required for a one-off; for the others the directory record supplies it. */
    name: z.string().trim().max(200).optional(),
    clinicName: z.string().trim().max(200).optional(),
    type: z.string().trim().max(40).optional(),
    gstin: z.string().trim().max(20).optional(),
    address: z.string().trim().max(400).optional(),
    city: z.string().trim().max(120).optional(),
    pinCode: z.string().trim().max(10).optional(),
    phone: z.string().trim().max(40).optional()
  }).optional(),
  /** Keep the buyer's GSTIN and state on their record, so the next bill needs no retyping. */
  saveDoctorDetails: z.boolean().default(true),

  items: z.array(itemSchema).min(1, "Add at least one product"),
  notes: z.string().trim().max(1000).optional(),
  terms: z.string().trim().max(2000).optional(),

  /** Money taken at the counter, recorded with the bill rather than after it. */
  payment: z.object({
    amount: z.number().positive(),
    mode: z.enum(PAYMENT_MODES),
    reference: z.string().trim().max(120).optional(),
    paidAt: dateField.optional()
  }).optional()
});

export type BillInput = z.infer<typeof billInputSchema>;

/** The buyer, flattened to the fields a bill needs, whichever directory they came from. */
export type Party = {
  doctorId?: unknown;
  customerId?: unknown;
  /** "Doctor", "Stockist", "Individual"… — printed on the bill and used for filtering. */
  type: string;
  name: string;
  /** Clinic or trading name, shown under the name. */
  subtitle?: string;
  address?: string;
  city?: string;
  pinCode?: string;
  stateCode?: string;
  gstin?: string;
  phone?: string;
  creditPeriod?: number;
};

export type ComposeFailure = { error: string; status: number };
export const failed = (value: unknown): value is ComposeFailure =>
  typeof value === "object" && value !== null && "error" in value;

/**
 * Finds whoever the bill is for.
 *
 * The three kinds of buyer differ only in where their details come from, so
 * they are reduced to one shape here and the rest of the route never has to ask
 * again. A one-off carries no record at all — a walk-in who buys once should
 * not leave a directory entry behind for somebody to tidy up later.
 */
export async function resolveParty(input: BillInput): Promise<Party | ComposeFailure> {
  if (input.partySource === "Customer") {
    if (!input.customer) return { error: "Choose the customer this bill is for", status: 400 };
    const customer = await Customer.findById(input.customer).lean() as {
      _id: unknown; type: string; name: string; businessName?: string; address?: string; city?: string;
      pinCode?: string; stateCode?: string; gstin?: string; phones?: string[]; creditPeriod?: number; active?: boolean;
    } | null;
    if (!customer) return { error: "Customer not found", status: 404 };
    if (customer.active === false) return { error: `${customer.name} is no longer an active customer`, status: 400 };
    return {
      customerId: customer._id,
      type: customer.type,
      name: customer.name,
      subtitle: customer.businessName,
      address: customer.address,
      city: customer.city,
      pinCode: customer.pinCode,
      stateCode: customer.stateCode,
      gstin: customer.gstin,
      phone: customer.phones?.[0],
      creditPeriod: customer.creditPeriod
    };
  }

  if (input.partySource === "One-off") {
    const name = input.billTo?.name?.trim();
    if (!name) return { error: "Enter the name this bill is for", status: 400 };
    return {
      type: input.billTo?.type?.trim() || "Individual",
      name,
      subtitle: input.billTo?.clinicName,
      address: input.billTo?.address,
      city: input.billTo?.city,
      pinCode: input.billTo?.pinCode,
      stateCode: "",
      gstin: input.billTo?.gstin,
      phone: input.billTo?.phone
    };
  }

  if (!input.doctor) return { error: "Choose the doctor this bill is for", status: 400 };
  const doctor = await Doctor.findById(input.doctor).lean() as {
    _id: unknown; name: string; clinicName?: string; fullAddress?: string; city?: string; area?: string;
    pinCode?: string; stateCode?: string; gstin?: string; phones?: string[];
  } | null;
  if (!doctor) return { error: "Doctor not found", status: 404 };
  return {
    doctorId: doctor._id,
    type: "Doctor",
    name: doctor.name,
    subtitle: doctor.clinicName,
    address: doctor.fullAddress,
    city: doctor.city || doctor.area,
    pinCode: doctor.pinCode,
    stateCode: doctor.stateCode,
    gstin: doctor.gstin,
    phone: doctor.phones?.[0]
  };
}

export type ComposedBill = {
  party: Party;
  gstin: string;
  placeOfSupplyCode: string;
  /** Every field of the bill that is derived from its contents. */
  fields: Record<string, unknown>;
};

/**
 * Prices a bill and lays out every field that follows from its contents.
 *
 * Every line has to be a catalogue product, so what is billed and what leaves
 * the warehouse are counted under the same name.
 */
export async function composeBill(input: BillInput, settings: SellerSettings): Promise<ComposedBill | ComposeFailure> {
  const party = await resolveParty(input);
  if (failed(party)) return party;

  const names = [...new Set(input.items.map(item => item.name))];
  const catalogue = await Product.find({ name: { $in: names } })
    .select("name hsnCode unit gstRate").lean() as unknown as Array<{
      _id: unknown; name: string; hsnCode?: string; unit?: string; gstRate?: number;
    }>;
  const byName = new Map(catalogue.map(product => [product.name, product]));
  const unknown = names.filter(name => !byName.has(name));
  if (unknown.length) return { error: `Not in the product catalogue: ${unknown.join(", ")}`, status: 400 };

  const placeOfSupplyCode = input.placeOfSupplyCode || party.stateCode || settings.stateCode || "";
  const interState = Boolean(input.taxed && settings.stateCode && placeOfSupplyCode && placeOfSupplyCode !== settings.stateCode);

  const { lines, totals } = computeInvoice(
    input.items.map(item => {
      const product = byName.get(item.name);
      return {
        ...item,
        hsnCode: item.hsnCode || product?.hsnCode || "",
        unit: item.unit || product?.unit || "Pcs",
        gstRate: input.taxed ? item.gstRate : 0
      };
    }),
    { taxed: input.taxed, interState, ratesIncludeTax: input.ratesIncludeTax }
  );

  const gstin = input.billTo?.gstin?.trim().toUpperCase() || party.gstin || "";

  return {
    party,
    gstin,
    placeOfSupplyCode,
    fields: {
      taxed: input.taxed,
      doctor: party.doctorId ?? null,
      customer: party.customerId ?? null,
      partySource: input.partySource,
      partyType: party.type,
      employee: input.employee,
      billTo: {
        name: party.name,
        clinicName: input.billTo?.clinicName || party.subtitle,
        type: party.type,
        address: input.billTo?.address || party.address,
        city: input.billTo?.city || party.city,
        state: stateName(placeOfSupplyCode),
        stateCode: placeOfSupplyCode,
        pinCode: input.billTo?.pinCode || party.pinCode,
        gstin,
        phone: input.billTo?.phone || party.phone
      },
      placeOfSupply: { state: stateName(placeOfSupplyCode), code: placeOfSupplyCode },
      interState,
      ratesIncludeTax: input.ratesIncludeTax,
      items: lines.map(line => ({ ...line, product: byName.get(line.name)?._id })),
      taxSummary: totals.taxSummary,
      subtotal: totals.subtotal,
      totalDiscount: totals.totalDiscount,
      taxableValue: totals.taxableValue,
      cgstTotal: totals.cgstTotal,
      sgstTotal: totals.sgstTotal,
      igstTotal: totals.igstTotal,
      taxTotal: totals.taxTotal,
      roundOff: totals.roundOff,
      grandTotal: totals.grandTotal,
      invoiceDate: fromDateInput(input.invoiceDate),
      dueDate: input.dueDate ? fromDateInput(input.dueDate) : undefined,
      paymentTerms: input.paymentTerms,
      followUpDate: input.followUpDate ? fromDateInput(input.followUpDate) : undefined,
      notes: input.notes,
      terms: input.terms ?? settings.terms
    }
  };
}

/**
 * Keeps what was learned about a buyer on their own record, so the next bill
 * needs no retyping. A one-off has nowhere to put it, and needs none.
 */
export async function rememberBuyerDetails(party: Party, gstin: string, placeOfSupplyCode: string) {
  if (!party.doctorId && !party.customerId) return;

  const patch: Record<string, string> = {};
  if (gstin && gstin !== party.gstin) patch.gstin = gstin;
  if (placeOfSupplyCode && placeOfSupplyCode !== party.stateCode) {
    patch.stateCode = placeOfSupplyCode;
    patch.state = stateName(placeOfSupplyCode);
  }
  if (!Object.keys(patch).length) return;

  await (party.doctorId
    ? Doctor.updateOne({ _id: party.doctorId }, { $set: patch })
    : Customer.updateOne({ _id: party.customerId }, { $set: patch }));
}
