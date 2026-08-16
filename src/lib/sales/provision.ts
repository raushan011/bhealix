import type { CommissionRule } from "./commission";
import { normaliseCode } from "./coupons";
import { httpJson, IntegrationError } from "./http";
import type { CouponSetupState } from "./partners";
import { loadCredentials, shopifyConfig } from "./settings";
import { assertShopDomain, type ShopifyConfig } from "./shopify";

/**
 * Creating a discount code in Shopify, rather than only reading the ones that
 * are already there.
 *
 * Every other Shopify call in this folder reads. This one writes, and it is the
 * only place in the application that does — because a rep minting their own
 * coupon inverts the order things used to happen in. A code used to be made in
 * Shopify and then typed in here; now it is asked for here and has to appear
 * over there, or the rep is left holding a code that fails at the checkout while
 * their own portal shows it as theirs. That is not a cosmetic gap: it is the
 * exact shape of "this company is cheating me".
 *
 * **Nothing here ever guesses.** If the shop is not connected, or nobody has said
 * what the rule's coupons take off, the code is reserved and reported as
 * `Awaiting setup`. A discount pushed at somebody's live storefront on a default
 * is a worse outcome than a code that visibly is not ready yet.
 */

/** The scope this needs. Reading discounts is `read_discounts`; creating one is not. */
export const WRITE_DISCOUNTS_SCOPE = "write_discounts";

/**
 * What became of the request, in the vocabulary the coupon is stored in.
 *
 * `Awaiting setup` and `Failed` are kept apart because they need different
 * people. The first is a gap in this company's own configuration, fixable on the
 * settings screen; the second is Shopify refusing something specific, and the
 * message is the only clue anybody will get.
 */
export type ProvisionOutcome =
  | { state: Extract<CouponSetupState, "Live">; shopifyDiscountId: string }
  | { state: Extract<CouponSetupState, "Awaiting setup" | "Failed">; reason: string };

/*
 * Both moved to `commission.ts`, where the rule itself lives, and re-exported
 * here so the server-side callers that already import them from this module
 * carry on working. The move was forced by the screens: this file loads Shopify
 * credentials on import, and a coupon list rendering in a browser cannot pull
 * that in to work out that a code takes ₹800 off.
 */
export { customerDiscountSummary, ruleIsProvisionable } from "./commission";

// Re-exporting does not bind the name in this module's own scope, and the
// provisioning path below asks the question itself.
import { ruleIsProvisionable } from "./commission";

const MUTATION = `
  mutation CreateCode($discount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $discount) {
      codeDiscountNode { id }
      userErrors { field message code }
    }
  }
`;

const DEACTIVATE = `
  mutation Deactivate($id: ID!) {
    discountCodeDeactivate(id: $id) {
      userErrors { field message code }
    }
  }
`;

type UserError = { field?: string[] | null; message?: string; code?: string };
type GraphQlBody<T> = { data?: T; errors?: { message?: string }[] };

/**
 * Runs one mutation and reduces the three ways Shopify can say no to a single
 * throw.
 *
 * GraphQL answers 200 with an `errors` array for a bad query or a missing scope,
 * and 200 with `userErrors` for a request it understood and rejected. Neither
 * looks like a failure to `httpJson`, so both are turned back into exceptions
 * here — otherwise a refused discount is indistinguishable from a created one.
 */
async function mutate<T extends Record<string, { userErrors?: UserError[] } | undefined>>(
  config: ShopifyConfig,
  query: string,
  variables: Record<string, unknown>,
  field: keyof T
): Promise<T[keyof T]> {
  const shop = assertShopDomain(config.domain);

  const { data } = await httpJson<GraphQlBody<T>>({
    service: "Shopify",
    url: `https://${shop}/admin/api/${config.apiVersion}/graphql.json`,
    method: "POST",
    headers: { "X-Shopify-Access-Token": config.accessToken },
    body: { query, variables }
  });

  if (data.errors?.length) {
    const reason = data.errors.map(error => error.message).filter(Boolean).join("; ");
    throw new IntegrationError("Shopify", /access denied|not approved|scope/i.test(reason)
      ? `Shopify refused because the app does not have the ${WRITE_DISCOUNTS_SCOPE} scope. Add it in the Dev Dashboard, release a version, then press Reconnect with Shopify.`
      : reason || "Shopify refused the request");
  }

  const result = data.data?.[field];
  const problems = result?.userErrors ?? [];
  if (problems.length) {
    throw new IntegrationError("Shopify", problems.map(problem => problem.message).filter(Boolean).join("; ") || "Shopify refused the discount");
  }

  return result as T[keyof T];
}

/**
 * Creates the discount code for a coupon somebody has just been given.
 *
 * Never throws. Every failure is an outcome the caller stores on the coupon,
 * because the coupon itself must be saved either way — a rep who pressed the
 * button and got an error page would press it again, and the second attempt
 * would collide with the code the first one had already reserved.
 */
export async function provisionCoupon(input: {
  code: string;
  rule: CommissionRule;
  repName: string;
}): Promise<ProvisionOutcome> {
  const code = normaliseCode(input.code);

  if (!ruleIsProvisionable(input.rule)) {
    return {
      state: "Awaiting setup",
      reason: `Nobody has said what coupons under the "${input.rule.label}" rule take off, so there was nothing to create. Set a customer discount for it in the affiliate settings.`
    };
  }

  let settings;
  try {
    settings = await loadCredentials();
  } catch {
    return { state: "Awaiting setup", reason: "The Shopify credentials could not be read." };
  }

  const config = shopifyConfig(settings);
  if (!config) {
    return { state: "Awaiting setup", reason: "Shopify is not connected, so the code could not be created in the shop." };
  }

  /*
   * The scope is checked before the call rather than after it, when Shopify
   * records one. A missing `write_discounts` comes back as "Access denied for
   * discountCodeBasicCreate field", which says nothing about the Dev Dashboard
   * or the release step that actually fixes it. Where the granted scopes are
   * unknown — a legacy pasted token records none — the call is simply attempted.
   */
  const granted = (settings.shopifyScopes ?? "").split(",").map(scope => scope.trim()).filter(Boolean);
  if (granted.length && !granted.includes(WRITE_DISCOUNTS_SCOPE)) {
    return {
      state: "Awaiting setup",
      reason: `The Shopify app has not been granted ${WRITE_DISCOUNTS_SCOPE}, so it cannot create discount codes. Add the scope in the Dev Dashboard, release a version, then press Reconnect with Shopify.`
    };
  }

  const percentage = input.rule.customerDiscountType !== "Fixed amount";
  const value = Number(input.rule.customerDiscountValue ?? 0);

  try {
    const result = await mutate<{ discountCodeBasicCreate?: { codeDiscountNode?: { id?: string } | null; userErrors?: UserError[] } }>(
      config,
      MUTATION,
      {
        discount: {
          // Named so somebody looking at Shopify's own Discounts screen can see
          // whose it is without opening the CRM.
          title: `${input.repName} — ${input.rule.label} (${code})`,
          code,
          startsAt: new Date().toISOString(),
          customerSelection: { all: true },
          customerGets: {
            // Shopify takes a percentage as a fraction: 10% is 0.1. Sending 10
            // would take the whole order off, which is the single most expensive
            // mistake available in this file.
            value: percentage
              ? { percentage: value / 100 }
              : { discountAmount: { amount: value.toFixed(2), appliesOnEachItem: false } },
            items: { all: true }
          },
          appliesOncePerCustomer: input.rule.oncePerCustomer !== false
        }
      },
      "discountCodeBasicCreate"
    );

    const id = result?.codeDiscountNode?.id;
    if (!id) return { state: "Failed", reason: "Shopify accepted the request but returned no discount." };
    return { state: "Live", shopifyDiscountId: id };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Shopify refused the discount";
    // A code the shop already has is not a broken request — it is very often a
    // code an administrator created by hand before the rep asked for it. Saying
    // which case it is turns a dead end into a one-click fix on the setup queue.
    return {
      state: "Failed",
      reason: /already|unique|taken/i.test(reason)
        ? `Shopify already has a discount code called ${code}. Check what it does, then mark it live here if it is the right one.`
        : reason
    };
  }
}

/**
 * Switches a discount off in Shopify.
 *
 * Used when a rep is suspended: their codes have to stop working at the
 * checkout, and withdrawing them only in this database would leave every one of
 * them live on the storefront, discounting orders that now credit nobody.
 *
 * Returns why it could not, rather than throwing — the suspension itself has
 * already been decided and must not fail because a third party was unreachable.
 */
export async function deactivateCoupon(shopifyDiscountId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const settings = await loadCredentials();
    const config = shopifyConfig(settings);
    if (!config) return { ok: false, reason: "Shopify is not connected." };

    await mutate<{ discountCodeDeactivate?: { userErrors?: UserError[] } }>(
      config, DEACTIVATE, { id: shopifyDiscountId }, "discountCodeDeactivate"
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Shopify refused to deactivate the code." };
  }
}
