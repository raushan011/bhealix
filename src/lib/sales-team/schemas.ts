import { z } from "zod";
import { DELIVERY_STATES, COURIER_RULES } from "@/lib/sales/constants";
import { INCENTIVE_PAY_MODES, INCENTIVE_TYPES, TEAM_ORDER_CHANNELS, TEAM_PAYMENT_MODES } from "./orders";
import { CATALOGUE_KINDS } from "./pricing";
import { WEIGHT_BASES } from "./packaging";

/**
 * What the sales team's routes accept. Pure, so the order form can validate with
 * the same rules the server enforces.
 */

const OBJECT_ID = /^[a-f\d]{24}$/i;
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name").max(120),
  phone: z.string().trim().min(10, "Enter a 10-digit phone number").max(20),
  email: text(160),
  address1: z.string().trim().min(3, "Enter the street address").max(200),
  address2: text(200),
  city: z.string().trim().min(2, "Enter the city").max(80),
  state: z.string().trim().min(2, "Enter the state").max(80),
  pinCode: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit pin code"),
  country: text(60)
});

/**
 * One line of an order: a catalogue item and how many. No price — prices come
 * from the catalogue and the handbook's rules on the server, never from the
 * request (§4.2).
 */
export const lineSchema = z.object({
  catalogueId: z.string().trim().min(1).max(60),
  quantity: z.number().int().min(1).max(99)
});

/**
 * The order as typed. Totals are absent on purpose — they are worked out from
 * the lines on the server and never taken from the request (§4.2).
 */
export const orderInputSchema = z.object({
  /** Only an administrator names the executive; an executive's own order is always theirs. */
  executive: z.string().regex(OBJECT_ID).optional(),
  lead: z.string().regex(OBJECT_ID).optional(),
  customer: customerSchema,
  items: z.array(lineSchema).min(1, "Add at least one product").max(20),
  /** The executive released the handbook's extra discount (combos and Kit, never COD). */
  extraDiscount: z.boolean().default(false),
  /** Add the free bag. */
  freeBag: z.boolean().default(false),
  paymentMode: z.enum(TEAM_PAYMENT_MODES),
  advancePaid: z.number().min(0).max(1_000_000).default(0),
  paymentReference: text(120),
  notes: text(1000)
});
export type OrderInput = z.infer<typeof orderInputSchema>;

export const orderPatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), order: orderInputSchema.omit({ executive: true, lead: true }) }),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(3, "Say why the order is being cancelled").max(300) }),
  z.object({
    action: z.literal("override"),
    state: z.enum(DELIVERY_STATES).nullable(),
    reason: z.string().trim().max(300).optional()
  }),
  z.object({ action: z.literal("reassign"), executive: z.string().regex(OBJECT_ID) })
]);

export const bookSchema = z.object({
  pickupLocation: z.string().trim().min(1, "Choose the pickup address"),
  /** Ignored: the parcel is worked out from the order and the packaging settings. Kept so older screens still post. */
  parcel: z.object({
    weight: z.number().positive().max(50),
    length: z.number().positive().max(200),
    breadth: z.number().positive().max(200),
    height: z.number().positive().max(200)
  }).optional(),
  courierId: z.number().int().positive().optional(),
  courierName: z.string().trim().max(80).optional(),
  courierRule: z.enum(COURIER_RULES).default("recommended"),
  schedulePickup: z.boolean().default(false)
});

export const ratesSchema = z.object({
  orderId: z.string().regex(OBJECT_ID),
  pickupLocation: z.string().trim().min(1),
  /** Ignored: the weight comes from the order and the packaging settings. */
  weight: z.number().positive().max(50).optional()
});

export const payIncentiveSchema = z.object({
  orderIds: z.array(z.string().regex(OBJECT_ID)).min(1).max(500),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date the money was sent"),
  mode: z.enum(INCENTIVE_PAY_MODES),
  reference: text(120),
  note: text(300)
});

export const unpayIncentiveSchema = z.object({
  orderId: z.string().regex(OBJECT_ID),
  reason: z.string().trim().min(3, "Say why the payment is being undone").max(300)
});

const catalogueItemSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, "Use lower-case letters, digits and dashes for the code"),
  name: z.string().trim().min(2).max(80),
  kind: z.enum(CATALOGUE_KINDS),
  mrp: z.number().min(0).max(100_000),
  offerPrice: z.number().min(0).max(100_000).optional(),
  floor: z.number().min(0).max(100_000).optional(),
  sku: z.string().trim().max(40).optional().or(z.literal("")),
  note: z.string().trim().max(200).optional().or(z.literal("")),
  active: z.boolean()
});

export const rulesSchema = z.object({
  /** Where executives' orders are placed. Optional, so the rules can be saved alone. */
  orderChannel: z.enum(TEAM_ORDER_CHANNELS).optional(),
  /** The products and their prices — the handbook's MRP list. */
  catalogue: z.array(catalogueItemSchema).min(1).max(40).optional(),
  /** The handbook's discount rules. */
  pricing: z.object({
    singlePct: z.number().min(0).max(90),
    comboPct: z.number().min(0).max(90),
    prepaidOff: z.number().min(0).max(10_000),
    extraPct: z.number().min(0).max(50),
    partialAdvance: z.number().min(0).max(100_000)
  }).optional(),
  /** The carton and the weights every parcel is booked at. */
  packaging: z.object({
    unitGrams: z.number().min(1, "Give what one product weighs").max(20_000),
    packagingGrams: z.number().min(0).max(20_000),
    length: z.number().min(1).max(200),
    breadth: z.number().min(1).max(200),
    height: z.number().min(1).max(200),
    basis: z.enum(WEIGHT_BASES),
    unitsPerKind: z.object(Object.fromEntries(CATALOGUE_KINDS.map(kind => [kind, z.number().min(0).max(50)])) as
      Record<(typeof CATALOGUE_KINDS)[number], z.ZodNumber>)
  }).optional(),
  incentiveRules: z.array(z.object({
    mode: z.enum(TEAM_PAYMENT_MODES),
    enabled: z.boolean(),
    type: z.enum(INCENTIVE_TYPES),
    value: z.number().min(0).max(100_000)
  })).length(TEAM_PAYMENT_MODES.length).optional(),
  /** Re-price every order not yet paid at the new rules, rather than only orders placed from now on. */
  applyToUnpaid: z.boolean().default(false)
}).superRefine((input, context) => {
  if (!input.incentiveRules) return;
  input.incentiveRules.forEach((rule, index) => {
    if (rule.type === "Percentage" && rule.value > 100) {
      context.addIssue({ code: "custom", path: ["incentiveRules", index, "value"], message: "A percentage cannot be more than 100" });
    }
  });
  if (new Set(input.incentiveRules.map(rule => rule.mode)).size !== TEAM_PAYMENT_MODES.length) {
    context.addIssue({ code: "custom", path: ["incentiveRules"], message: "Give one rule for each payment mode" });
  }
});

export const assignSchema = z.object({
  leadIds: z.array(z.string().regex(OBJECT_ID)).min(1, "Choose at least one lead").max(1000),
  /** Null hands the leads back to the desk. */
  executive: z.string().regex(OBJECT_ID).nullable()
});

/** Orders moved, in a batch, to the executive whose sale they really were. */
export const orderAssignSchema = z.object({
  orderIds: z.array(z.string().regex(OBJECT_ID)).min(1, "Choose at least one order").max(500),
  executive: z.string().regex(OBJECT_ID)
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The order form's live check: can a courier reach this, and how risky is it. */
export const checkSchema = z.object({
  pinCode: z.string().trim().max(10).optional(),
  phone: z.string().trim().max(20).optional(),
  paymentMode: z.enum(TEAM_PAYMENT_MODES),
  total: z.number().min(0).max(10_000_000).default(0),
  advance: z.number().min(0).max(10_000_000).default(0),
  address1: z.string().trim().max(200).optional(),
  address2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional()
});

/** What to tell the courier about a failed delivery. */
export const ndrSchema = z.object({
  action: z.enum(["re-attempt", "return"]),
  /** A particular day the customer asked for; omitted means the courier's next round. */
  deferredDate: z.string().regex(DAY, "Choose the day").optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  address1: z.string().trim().max(200).optional().or(z.literal("")),
  address2: z.string().trim().max(200).optional().or(z.literal("")),
  comments: z.string().trim().min(3, "Say what the customer told you").max(300)
});

/** A customer an executive adds themselves, to follow up. */
export const ownLeadSchema = z.object({
  name: z.string().trim().min(2, "Enter the name").max(120),
  phone: z.string().trim().min(10, "Enter a 10-digit phone number").max(20),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  type: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  followUpAt: z.string().regex(DAY).optional().or(z.literal("")),
  followUpNote: z.string().trim().max(300).optional().or(z.literal(""))
});

/** Setting, moving or clearing a lead's next follow-up. */
export const followUpSchema = z.object({
  followUpAt: z.string().regex(DAY, "Choose the day").nullable(),
  followUpNote: z.string().trim().max(300).optional().or(z.literal(""))
});
