import { httpJson } from "@/lib/sales/http";
import { formatPeriod, periodDays } from "../period";
import { buildStatement, sumRupees } from "../statement";
import type { Connector, FetchResult } from "./types";

/**
 * Meta advertising, read from the ad account.
 *
 * The Marketing API will tell you, precisely and per day, what an ad account
 * spent. It will not give you the receipt: Meta charges a card and publishes the
 * transaction in Ads Manager's billing hub, and the `business_invoices` edge
 * that would return one exists only for accounts on credit-line invoicing, which
 * an ordinary card-billed account is not. So this fetches the spend — which is
 * the figure the CA is reconciling against the card statement — and the vault
 * goes on asking for the receipt.
 *
 * Daily rather than one monthly total on purpose. A month's advertising is
 * queried far more often as "what did we spend the week of the sale" than as one
 * number, and a daily breakdown answers both while a total answers one.
 */

const BASE = "https://graph.facebook.com/v21.0";

/**
 * The account id with its `act_` prefix, however it was typed.
 *
 * Meta shows it as `act_1234567890` in some screens and `1234567890` in others,
 * and the API accepts only the first. Pasting what is on screen should work
 * either way rather than failing with a 400 about an unknown node.
 */
const accountId = (raw: string) => {
  const trimmed = raw.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
};

type Insight = { date_start?: string; date_stop?: string; spend?: string };

export const meta: Connector = {
  key: "meta",
  label: "Meta Ads",
  consoleUrl: "https://business.facebook.com/settings/system-users",
  guidance:
    "Business Settings → Users → System Users → Add, then Generate New Token against your app with the "
    + "`ads_read` permission. A system user token does not expire with a person's password, which is what "
    + "makes it the right one for a monthly job. Assign the ad account to that system user as well.",
  fields: [
    { name: "adAccountId", label: "Ad account ID", secret: false, required: true, placeholder: "act_1234567890", hint: "Ads Manager → Account Overview, top left" },
    { name: "accessToken", label: "System user access token", secret: true, required: true, hint: "Needs ads_read on this ad account" }
  ],

  /**
   * Reads the account's own name and currency.
   *
   * A better test than a spend query: it proves the token is valid *and* that it
   * has been granted this particular ad account, which is the mistake people
   * actually make — a system user with a perfectly good token and no asset
   * assigned to it.
   */
  async test(credentials) {
    const query = new URLSearchParams({ fields: "name,currency", access_token: credentials.accessToken });
    const { data } = await httpJson<{ name?: string; currency?: string }>({
      service: "Meta", url: `${BASE}/${accountId(credentials.adAccountId)}?${query}`
    });
    return data.name
      ? `Connected to ${data.name}${data.currency ? ` (${data.currency})` : ""}.`
      : "Connected to Meta, though the account returned no name.";
  },

  async fetch(credentials, period): Promise<FetchResult> {
    const { from, to } = periodDays(period);
    const account = accountId(credentials.adAccountId);

    const currencyQuery = new URLSearchParams({ fields: "currency", access_token: credentials.accessToken });
    const { data: profile } = await httpJson<{ currency?: string }>({
      service: "Meta", url: `${BASE}/${account}?${currencyQuery}`
    });

    const query = new URLSearchParams({
      fields: "spend",
      time_range: JSON.stringify({ since: from, until: to }),
      // Daily, so the statement is a breakdown rather than a single number.
      time_increment: "1",
      access_token: credentials.accessToken
    });

    const { data } = await httpJson<{ data?: Insight[] }>({
      service: "Meta", url: `${BASE}/${account}/insights?${query}`
    });

    const days = (data.data ?? []).filter(row => Number(row.spend) > 0);
    if (!days.length) {
      return { documents: [], message: `Meta reports no advertising spend for ${formatPeriod(period)}.` };
    }

    const amounts = days.map(row => Math.round(Number(row.spend) * 100) / 100);
    const total = sumRupees(amounts);
    const currency = profile.currency ?? "INR";

    const statement = buildStatement({
      vendor: "Meta — advertising spend",
      period,
      columns: ["Date", "Spend", "Currency"],
      rows: days.map((row, index) => [row.date_start ?? "", amounts[index], currency]),
      /*
       * No tax figure. Meta's spend is what was charged, and whether GST sits on
       * top of it depends on the billing country and whether a GSTIN is on the
       * account — none of which the insights edge reports. Guessing a number
       * onto a line an accountant will claim credit against would be worse than
       * leaving it blank and saying so.
       */
      totals: { amount: total },
      note: "Spend only. Meta's insights do not report GST, so the tax on this is taken from the receipt in Ads Manager."
    });

    return {
      documents: [{
        externalRef: `meta:spend:${period}`,
        fileName: `meta-ads-spend-${period}.csv`,
        contentType: "text/csv",
        data: statement,
        description: `Advertising spend across ${days.length} day${days.length === 1 ? "" : "s"} (${from} to ${to})`,
        amount: total
      }],
      message: `Meta: ${currency} ${total.toLocaleString("en-IN")} spent across ${days.length} day${days.length === 1 ? "" : "s"} in ${formatPeriod(period)}. The receipt itself is in Ads Manager — file that PDF as well.`
    };
  }
};
