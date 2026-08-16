import { httpJson, IntegrationError } from "@/lib/sales/http";
import { normaliseDomain } from "@/lib/sales/shopify";
import { formatPeriod, periodDays } from "../period";
import { buildStatement, sumRupees } from "../statement";
import type { Connector, Credentials, FetchResult } from "./types";

/**
 * Shopify, read with an Admin API token.
 *
 * The narrowest of the four, and worth being plain about. Shopify's Admin API
 * does not expose the merchant's own subscription invoice — the plan, the apps
 * and the bill for them live in the admin under Settings → Billing and nowhere
 * else. What it *does* expose, when the shop uses Shopify Payments, is the
 * payouts: each one carrying the gross, the processing fee and what was actually
 * deposited. That fee is a real cost with a real bank line against it, and
 * reconciling it is a real job, so that is what this fetches.
 *
 * A shop not on Shopify Payments gets a clear "nothing to fetch" rather than an
 * error, because that is the truth for it and there is nothing to fix.
 */

const scope = "read_shopify_payments_payouts";

type Payout = {
  id?: number | string;
  date?: string;
  status?: string;
  currency?: string;
  amount?: string | number;
  summary?: {
    charges_gross_amount?: string | number;
    charges_fee_amount?: string | number;
    refunds_fee_amount?: string | number;
    adjustments_fee_amount?: string | number;
  };
};

const money = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

const base = (credentials: Credentials) =>
  `https://${normaliseDomain(credentials.domain)}/admin/api/${credentials.apiVersion || "2026-07"}`;

const auth = (credentials: Credentials) => ({ "x-shopify-access-token": credentials.accessToken });

export const shopify: Connector = {
  key: "shopify",
  label: "Shopify",
  consoleUrl: "https://admin.shopify.com/settings/apps/development",
  guidance:
    `Settings → Apps and sales channels → Develop apps → your app → Admin API access scopes, and grant `
    + `\`${scope}\`. The Sales CRM already holds a token for this shop, but it was granted for orders — `
    + `a token without the payouts scope reads nothing here, so either add the scope there or paste a `
    + `separate token below.`,
  fields: [
    { name: "domain", label: "Shop domain", secret: false, required: true, placeholder: "your-shop.myshopify.com" },
    { name: "accessToken", label: "Admin API access token", secret: true, required: true, hint: `Needs ${scope}` },
    { name: "apiVersion", label: "API version", secret: false, required: false, placeholder: "2026-07" }
  ],

  async test(credentials) {
    /*
     * The shop record, not the payouts, because a shop with no Shopify Payments
     * answers the payouts endpoint with a 403 — and reporting "not connected"
     * for a token that is perfectly good would send somebody off to regenerate
     * a key that was never the problem.
     */
    const { data } = await httpJson<{ shop?: { name?: string; myshopify_domain?: string } }>({
      service: "Shopify", url: `${base(credentials)}/shop.json`, headers: auth(credentials)
    });
    return data.shop?.name ? `Connected to ${data.shop.name}.` : "Connected to Shopify.";
  },

  async fetch(credentials, period): Promise<FetchResult> {
    const { from, to } = periodDays(period);
    const query = new URLSearchParams({ date_min: from, date_max: to, limit: "250" });

    let payouts: Payout[];
    try {
      const { data } = await httpJson<{ payouts?: Payout[] }>({
        service: "Shopify", url: `${base(credentials)}/shopify_payments/payouts.json?${query}`, headers: auth(credentials)
      });
      payouts = data.payouts ?? [];
    } catch (error) {
      /*
       * 403 here is not a broken token — it is a shop that does not use Shopify
       * Payments, or a token granted without the payouts scope. Both are states
       * to explain rather than errors to throw, since neither is fixed by trying
       * again and one is not fixable at all.
       */
      if (error instanceof IntegrationError && (error.status === 403 || error.status === 404)) {
        return {
          documents: [],
          message: `Shopify would not return payouts for this shop. Either it does not use Shopify Payments, `
            + `or the token lacks \`${scope}\`. The subscription bill is not on the API in any case — file that PDF from Settings → Billing.`
        };
      }
      throw error;
    }

    if (!payouts.length) {
      return {
        documents: [],
        message: `Shopify made no payouts in ${formatPeriod(period)}. The subscription bill is not on the API — file that PDF from Settings → Billing.`
      };
    }

    const fees = payouts.map(row => money(row.summary?.charges_fee_amount)
      + money(row.summary?.refunds_fee_amount) + money(row.summary?.adjustments_fee_amount));
    const totalFee = sumRupees(fees);
    const currency = payouts[0]?.currency ?? "INR";

    const statement = buildStatement({
      vendor: "Shopify — payment processing fees",
      period,
      columns: ["Payout ID", "Date", "Status", "Gross charges", "Processing fee", "Deposited", "Currency"],
      rows: payouts.map((row, index) => [
        row.id ?? "", row.date ?? "", row.status ?? "",
        money(row.summary?.charges_gross_amount), fees[index], money(row.amount), row.currency ?? currency
      ]),
      totals: { amount: totalFee },
      note: "Processing fees only. The Shopify plan and app charges are billed separately and are not on this API."
    });

    return {
      documents: [{
        externalRef: `shopify:payouts:${period}`,
        fileName: `shopify-payout-fees-${period}.csv`,
        contentType: "text/csv",
        data: statement,
        description: `Processing fees across ${payouts.length} payout${payouts.length === 1 ? "" : "s"} (${from} to ${to})`,
        amount: totalFee
      }],
      message: `Shopify: ${currency} ${totalFee.toLocaleString("en-IN")} in processing fees across ${payouts.length} payout${payouts.length === 1 ? "" : "s"}. The plan and app bill is not on the API — file that PDF as well.`
    };
  }
};
