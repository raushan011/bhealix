import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { BillingSettings } from "@/models/Settings";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { loadSettings } from "@/lib/billing/invoices";
import { GSTIN_PATTERN, STATE_CODES } from "@/lib/billing/constants";

const optional = (max = 200) => z.string().trim().max(max).optional();

const schema = z.object({
  legalName: z.string().trim().min(2, "Legal name is required"),
  tradeName: optional(),
  address: optional(400),
  city: optional(),
  state: optional(),
  stateCode: z.enum(STATE_CODES as [string, ...string[]]).optional().or(z.literal("")),
  pinCode: optional(10),
  // Blank is allowed — a business below the threshold has no GSTIN and raises a
  // bill of supply. A wrong one is not: the invoice would be unusable.
  gstin: z.string().trim().toUpperCase().regex(GSTIN_PATTERN, "Enter a valid 15-character GSTIN").optional().or(z.literal("")),
  pan: optional(15),
  phone: optional(40),
  email: optional(),
  website: optional(),
  drugLicenceNo: optional(),
  bankName: optional(),
  bankAccountName: optional(),
  bankAccountNo: optional(40),
  bankIfsc: optional(20),
  upiId: optional(),
  invoicePrefix: z.string().trim().max(12).optional(),
  defaultPaymentTerms: z.number().int().min(0).max(365).optional(),
  defaultGstRate: z.number().min(0).max(50).optional(),
  ratesIncludeTax: z.boolean().optional(),
  terms: optional(1000),
  signatoryName: optional()
});

export async function GET() {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();
    return ok({ settings: await loadSettings() });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await apiSession(can.manageBilling);
    if ("response" in auth) return auth.response;
    await connectDb();

    const value = schema.parse(await request.json());
    const settings = await BillingSettings.findOneAndUpdate(
      { key: "billing" }, { $set: value }, { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    ).lean();
    return ok({ settings });
  } catch (error) {
    return fail(error);
  }
}
