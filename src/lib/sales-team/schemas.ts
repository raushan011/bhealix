import { z } from "zod";
import { DELIVERY_STATES, COURIER_RULES } from "@/lib/sales/constants";
import { INCENTIVE_PAY_MODES, INCENTIVE_TYPES, TEAM_ORDER_CHANNELS, TEAM_PAYMENT_MODES } from "./orders";

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

export const lineSchema = z.object({
  product: z.string().regex(OBJECT_ID).optional(),
  /** A Shopify variant id — digits. */
  variantId: z.string().regex(/^\d{1,20}$/).optional(),
  sku: text(60),
  title: z.string().trim().min(1, "Name the product").max(160),
  quantity: z.number().int().min(1).max(999),
  price: z.number().min(0).max(1_000_000)
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
  items: z.array(lineSchema).min(1, "Add at least one product").max(30),
  discount: z.number().min(0).max(1_000_000).default(0),
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
  parcel: z.object({
    weight: z.number().positive().max(50),
    length: z.number().positive().max(200),
    breadth: z.number().positive().max(200),
    height: z.number().positive().max(200)
  }),
  courierId: z.number().int().positive().optional(),
  courierName: z.string().trim().max(80).optional(),
  courierRule: z.enum(COURIER_RULES).default("recommended"),
  schedulePickup: z.boolean().default(false)
});

export const ratesSchema = z.object({
  orderId: z.string().regex(OBJECT_ID),
  pickupLocation: z.string().trim().min(1),
  weight: z.number().positive().max(50)
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

export const rulesSchema = z.object({
  /** Where executives' orders are placed. Optional, so the rules can be saved alone. */
  orderChannel: z.enum(TEAM_ORDER_CHANNELS).optional(),
  incentiveRules: z.array(z.object({
    mode: z.enum(TEAM_PAYMENT_MODES),
    enabled: z.boolean(),
    type: z.enum(INCENTIVE_TYPES),
    value: z.number().min(0).max(100_000)
  })).length(TEAM_PAYMENT_MODES.length),
  /** Re-price every order not yet paid at the new rules, rather than only orders placed from now on. */
  applyToUnpaid: z.boolean().default(false)
}).superRefine((input, context) => {
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
