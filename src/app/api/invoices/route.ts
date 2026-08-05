import { z } from "zod";
import { Types, type FilterQuery } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { Invoice } from "@/models/Invoice";
import { Doctor } from "@/models/Doctor";
import { Customer } from "@/models/Customer";
import { Product } from "@/models/Catalog";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel, type Role } from "@/constants/access";
import { badRequest, fail, ok, pageParams, OBJECT_ID } from "@/lib/api";
import { fromDateInput } from "@/lib/time";
import { computeInvoice } from "@/lib/billing/gst";
import { loadSettings, nextInvoiceNumber, recalculate } from "@/lib/billing/invoices";
import { DISCOUNT_TYPES, INVOICE_STATUSES, PARTY_SOURCES, PAYMENT_MODES, stateName, STATE_CODES } from "@/lib/billing/constants";
import { syncInvoiceStock } from "@/lib/inventory/ledger";

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

const schema = z.object({
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

/** The buyer, flattened to the fields a bill needs, whichever directory they came from. */
type Party = {
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
  /** Credit period the buyer's record proposes, where they have one. */
  creditPeriod?: number;
};

/**
 * Finds whoever the bill is for.
 *
 * The three kinds of buyer differ only in where their details come from, so
 * they are reduced to one shape here and the rest of the route never has to ask
 * again. A one-off carries no record at all — a walk-in who buys once should
 * not leave a directory entry behind for somebody to tidy up later.
 */
async function resolveParty(input: z.infer<typeof schema>): Promise<Party | { error: string; status: number }> {
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
      // Totals for the whole filtered set, not just the page on screen.
      Invoice.aggregate<{ _id: null; billed: number; collected: number; outstanding: number }>([
        { $match: { ...filter, status: { $ne: "Cancelled" } } },
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

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageBilling);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = schema.parse(await request.json());
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
    const party = await resolveParty(input);
    if ("error" in party) return badRequest(party.error, party.status);
    if (!employee) return badRequest("Representative not found", 404);
    if (!usesFieldPanel(employee.role)) return badRequest("A bill belongs to a medical representative or a sales executive");
    if (!employee.active) return badRequest(`${employee.name} is deactivated`);

    // Every line has to be a catalogue product, so what is billed and what
    // leaves the warehouse are counted under the same name.
    const names = [...new Set(input.items.map(item => item.name))];
    const catalogue = await Product.find({ name: { $in: names } })
      .select("name hsnCode unit gstRate").lean() as unknown as Array<{
        _id: unknown; name: string; hsnCode?: string; unit?: string; gstRate?: number;
      }>;
    const byName = new Map(catalogue.map(product => [product.name, product]));
    const unknown = names.filter(name => !byName.has(name));
    if (unknown.length) return badRequest(`Not in the product catalogue: ${unknown.join(", ")}`);

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

    const { invoiceNo, year } = await nextInvoiceNumber(settings.invoicePrefix, fromDateInput(input.invoiceDate));

    const gstin = input.billTo?.gstin?.trim().toUpperCase() || party.gstin || "";
    const invoice = new Invoice({
      invoiceNo,
      financialYear: year,
      taxed: input.taxed,
      doctor: party.doctorId,
      customer: party.customerId,
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
      terms: input.terms ?? settings.terms,
      createdBy: auth.session.userId,
      payments: input.payment
        ? [{
            amount: Math.min(input.payment.amount, totals.grandTotal),
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

    // Learned once, kept for next time — but only where there is a record to
    // keep it on. A one-off sale has nowhere to put it, and needs none.
    if (input.saveDoctorDetails && (party.doctorId || party.customerId)) {
      const patch: Record<string, string> = {};
      if (gstin && gstin !== party.gstin) patch.gstin = gstin;
      if (placeOfSupplyCode && placeOfSupplyCode !== party.stateCode) {
        patch.stateCode = placeOfSupplyCode;
        patch.state = stateName(placeOfSupplyCode);
      }
      if (Object.keys(patch).length) {
        await (party.doctorId
          ? Doctor.updateOne({ _id: party.doctorId }, { $set: patch })
          : Customer.updateOne({ _id: party.customerId }, { $set: patch }));
      }
    }

    return ok({ _id: invoice._id, invoiceNo: invoice.invoiceNo, grandTotal: invoice.grandTotal, status: invoice.status }, 201);
  } catch (error) {
    return fail(error);
  }
}
