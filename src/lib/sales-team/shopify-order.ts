import { collectAmountOf, money, PAYMENT_MODE_LABEL, type TeamPaymentMode } from "./orders";

/**
 * A sales executive's order, written into Shopify.
 *
 * Pure, and tested, because it decides money in somebody else's system: what
 * Shopify records as paid, what it records as owed at the door, and which stock
 * comes off. The calls themselves live in `shopify-api.ts`.
 *
 * Why Shopify at all, when the CRM could book the courier directly: the shop is
 * where every order the company takes is tracked, counted and fulfilled. An
 * executive's sale placed there is filterable per person (`tags`), comes off the
 * shop's own inventory, reaches Shiprocket through the same channel as every
 * other order, and shows up in the retargeting list like any customer — instead
 * of being a second order book only this CRM knows about.
 */

/** The discount code a team order's discount is filed under. Ignored by attribution — it ends in no digits. */
export const TEAM_DISCOUNT_CODE = "SALES-TEAM";

/** Every team order carries this tag, so the shop's own order list can be filtered to the sales team. */
export const TEAM_TAG = "Sales team";

/** `exec-BHX-SE-01` — the per-person tag, from the employee ID, which never changes when a name does. */
export const executiveTag = (employeeId: string) =>
  `exec-${String(employeeId).trim().replace(/[^\w-]+/g, "-")}`;

export type ShopifyOrderInput = {
  ref: string;
  executive: { name: string; employeeId: string };
  customer: { name: string; phone: string; email?: string; address1: string; address2?: string; city: string; state: string; pinCode: string; country?: string };
  lines: { variantId?: string; title: string; sku?: string; quantity: number; price: number }[];
  discount: number;
  total: number;
  paymentMode: TeamPaymentMode;
  advance: number;
  paymentReference?: string;
  notes?: string;
};

const split = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  return { first_name: first || "Customer", last_name: rest.join(" ") || "." };
};

const amount = (value: number) => money(value).toFixed(2);

/**
 * The `orders.json` body.
 *
 * Three decisions in it that are not plumbing:
 *
 * 1. **No `customer` object.** Shopify creates or matches a customer from one,
 *    and refuses the whole order when the phone already belongs to somebody —
 *    an ordinary state for a repeat buyer. The address carries the phone, and an
 *    email (when there is one) still links the order to the customer it names.
 * 2. **Payment is written as transactions**, which is how Shopify itself and the
 *    Shiprocket channel read it: a successful sale for whatever arrived up front,
 *    and a pending COD transaction for what the courier is to collect. A part
 *    payment is therefore `partially_paid` with the balance pending at the door.
 * 3. **Stock comes off the shop's inventory** wherever a line names a variant,
 *    obeying the shop's own oversell policy — the shop is the stock of record for
 *    everything sold online.
 */
export function buildShopifyOrder(input: ShopifyOrderInput) {
  const name = split(input.customer.name);
  const address = {
    ...name,
    address1: input.customer.address1,
    address2: input.customer.address2 || undefined,
    city: input.customer.city,
    province: input.customer.state,
    zip: input.customer.pinCode,
    country: input.customer.country || "India",
    phone: input.customer.phone
  };

  const upfront = input.paymentMode === "Prepaid" ? input.total : input.paymentMode === "Partial" ? input.advance : 0;
  const atDoor = collectAmountOf(input.paymentMode, input.total, input.advance);
  const transactions = [
    ...(upfront > 0 ? [{ kind: "sale", status: "success", amount: amount(upfront), gateway: "manual" }] : []),
    ...(atDoor > 0 ? [{ kind: "sale", status: "pending", amount: amount(atDoor), gateway: "Cash on Delivery (COD)" }] : [])
  ];

  return {
    order: {
      line_items: input.lines.map(line => line.variantId
        ? { variant_id: Number(line.variantId), quantity: line.quantity, price: amount(line.price) }
        : { title: line.title, sku: line.sku || undefined, quantity: line.quantity, price: amount(line.price), requires_shipping: true, taxable: true }),
      email: input.customer.email || undefined,
      shipping_address: address,
      billing_address: address,
      financial_status: input.paymentMode === "Prepaid" ? "paid" : input.paymentMode === "Partial" ? "partially_paid" : "pending",
      transactions,
      ...(input.discount > 0 ? { discount_codes: [{ code: TEAM_DISCOUNT_CODE, amount: amount(input.discount), type: "fixed_amount" }] } : {}),
      tags: [TEAM_TAG, executiveTag(input.executive.employeeId), input.executive.name].join(", "),
      note: [`Placed by ${input.executive.name} (${input.executive.employeeId}) through the BHEALIX CRM — ${input.ref}.`, input.notes].filter(Boolean).join("\n"),
      note_attributes: [
        { name: "Sales executive", value: input.executive.name },
        { name: "Executive ID", value: input.executive.employeeId },
        { name: "CRM order", value: input.ref },
        { name: "Payment", value: PAYMENT_MODE_LABEL[input.paymentMode] },
        ...(input.advance > 0 && input.paymentMode === "Partial" ? [{ name: "Advance paid", value: amount(input.advance) }] : []),
        ...(input.paymentReference ? [{ name: "Payment reference", value: input.paymentReference }] : [])
      ],
      inventory_behaviour: "decrement_obeying_policy",
      send_receipt: false,
      send_fulfillment_receipt: false
    }
  };
}

/** Whether the connection was granted the scope placing an order needs. */
export const canWriteOrders = (grantedScopes: string | undefined | null) =>
  String(grantedScopes ?? "").split(",").map(scope => scope.trim()).includes("write_orders");

/** The order as the merchant sees it in Shopify's admin. */
export const shopifyAdminOrderUrl = (domain: string, orderId: string) =>
  `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/admin/orders/${orderId}`;
