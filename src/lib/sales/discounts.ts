import { httpJson } from "./http";
import { normaliseCode } from "./coupons";
import { assertShopDomain, type ShopifyConfig } from "./shopify";

/**
 * The discount codes Shopify holds, so the CRM does not have to be told about
 * them twice.
 *
 * A coupon is created in Shopify and then has to be typed in here before an
 * order using it can be attributed — and a code that exists in one place and
 * not the other is money going out with nobody credited. Reading the catalogue
 * closes that loop: every code appears, whether or not anybody has claimed it.
 *
 * **GraphQL, not the REST price-rules endpoint.** Shopify has been moving
 * discounts off REST for years and `price_rules` is on its way out; the
 * `codeDiscountNodes` query is the supported way to ask and returns the code,
 * its status and what it does in one round trip.
 *
 * Needs the `read_discounts` scope. Without it this fails, and the caller falls
 * back to the codes seen on orders — fewer, but free.
 */

export type ShopDiscount = {
  code: string;
  title: string;
  /** ACTIVE, EXPIRED or SCHEDULED, as Shopify reports it. */
  status: string;
  /** "₹800 off" or "10% off", for the list to show without a second lookup. */
  summary: string;
  startsAt?: string;
  endsAt?: string;
  usageCount?: number;
};

type Money = { amount?: string };
type Node = {
  codeDiscount?: {
    title?: string;
    status?: string;
    startsAt?: string;
    endsAt?: string;
    usageCount?: number;
    codes?: { edges?: { node?: { code?: string } }[] };
    customerGets?: {
      value?: {
        percentage?: number;
        amount?: Money;
        appliesOnEachItem?: boolean;
      };
    };
  };
};

const QUERY = `
  query CodeDiscounts($cursor: String) {
    codeDiscountNodes(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              title status startsAt endsAt usageCount
              codes(first: 20) { edges { node { code } } }
              customerGets { value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount } appliesOnEachItem }
              } }
            }
            ... on DiscountCodeBxgy { title status startsAt endsAt usageCount
              codes(first: 20) { edges { node { code } } } }
            ... on DiscountCodeFreeShipping { title status startsAt endsAt usageCount
              codes(first: 20) { edges { node { code } } } }
          }
        }
      }
    }
  }
`;

const summarise = (node: Node["codeDiscount"]): string => {
  const value = node?.customerGets?.value;
  if (value?.percentage) return `${Math.round(value.percentage * 100)}% off`;
  if (value?.amount?.amount) {
    return `₹${Math.round(Number(value.amount.amount))} off${value.appliesOnEachItem ? " each item" : ""}`;
  }
  return node?.title ?? "Discount";
};

/** Every code discount on the shop, paged through. */
export async function fetchDiscounts(config: ShopifyConfig, maxPages = 10): Promise<ShopDiscount[]> {
  const shop = assertShopDomain(config.domain);
  const discounts: ShopDiscount[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const { data } = await httpJson<{
      data?: { codeDiscountNodes?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string }; edges?: { node?: Node }[] } };
      errors?: { message?: string }[];
    }>({
      service: "Shopify",
      url: `https://${shop}/admin/api/${config.apiVersion}/graphql.json`,
      method: "POST",
      headers: { "X-Shopify-Access-Token": config.accessToken },
      body: { query: QUERY, variables: { cursor } }
    });

    // GraphQL answers 200 with an `errors` array, so a missing scope arrives
    // looking like a success. Turning it back into a throw is what lets the
    // caller fall back rather than quietly show an empty catalogue.
    if (data.errors?.length) {
      throw new Error(data.errors.map(error => error.message).filter(Boolean).join("; ") || "Shopify refused the discounts query");
    }

    const connection = data.data?.codeDiscountNodes;
    for (const edge of connection?.edges ?? []) {
      const discount = edge.node?.codeDiscount;
      if (!discount) continue;

      for (const codeEdge of discount.codes?.edges ?? []) {
        const code = normaliseCode(codeEdge.node?.code ?? "");
        if (!code) continue;
        discounts.push({
          code,
          title: discount.title ?? code,
          status: discount.status ?? "ACTIVE",
          summary: summarise(discount),
          startsAt: discount.startsAt,
          endsAt: discount.endsAt,
          usageCount: discount.usageCount
        });
      }
    }

    if (!connection?.pageInfo?.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }

  return discounts;
}

/** Whether a code is one anybody could still use today. */
export const isLive = (status: string) => status.toUpperCase() === "ACTIVE";
