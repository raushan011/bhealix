import { z } from "zod";
import { CUSTOMER_TYPES, GSTIN_PATTERN, STATE_CODES } from "./constants";

/**
 * The shape of a trade buyer, shared by the create and update routes so the two
 * cannot drift into accepting different things.
 */
export const customerSchema = z.object({
  type: z.enum(CUSTOMER_TYPES).default("Stockist"),
  name: z.string().trim().min(2, "Name is required"),
  businessName: z.string().trim().max(200).optional(),
  contactPerson: z.string().trim().max(120).optional(),
  phones: z.array(z.string().trim().max(40)).default([]),
  email: z.string().trim().max(160).optional(),
  address: z.string().trim().max(400).optional(),
  city: z.string().trim().max(120).optional(),
  stateCode: z.enum(STATE_CODES as [string, ...string[]]).optional().or(z.literal("")),
  pinCode: z.string().trim().max(10).optional(),
  // Blank is fine — an unregistered buyer has no GSTIN. A malformed one is not:
  // the bill would be unusable to them.
  gstin: z.string().trim().toUpperCase().regex(GSTIN_PATTERN, "Enter a valid 15-character GSTIN").optional().or(z.literal("")),
  pan: z.string().trim().max(15).optional(),
  drugLicenceNo: z.string().trim().max(60).optional(),
  creditPeriod: z.number().int().min(0).max(365).default(0),
  creditLimit: z.number().min(0).default(0),
  notes: z.string().trim().max(1000).optional(),
  active: z.boolean().optional()
});

/** Everything the buyer directory and a billing line need to read. */
export const CUSTOMER_FIELDS =
  "code type name businessName contactPerson phones email address city state stateCode pinCode gstin pan drugLicenceNo creditPeriod creditLimit notes active";

/** One buyer, as the browser reads them. */
export type CustomerRecord = {
  _id: string;
  code: string;
  type: (typeof CUSTOMER_TYPES)[number];
  name: string;
  businessName?: string;
  contactPerson?: string;
  phones?: string[];
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pinCode?: string;
  gstin?: string;
  pan?: string;
  drugLicenceNo?: string;
  creditPeriod?: number;
  creditLimit?: number;
  notes?: string;
  active: boolean;
};

/** Name plus trading name, without repeating one that equals the other. */
export const customerTitle = (customer: Pick<CustomerRecord, "name" | "businessName">) =>
  customer.businessName && customer.businessName !== customer.name
    ? `${customer.name} · ${customer.businessName}`
    : customer.name;
