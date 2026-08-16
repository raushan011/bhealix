import { httpJson, IntegrationError } from "@/lib/sales/http";
import { formatPeriod, periodDays, periodRange } from "../period";
import { buildStatement, fromPaise, sumRupees } from "../statement";
import type { Connector, Credentials, FetchResult } from "./types";

/**
 * Razorpay, read with the merchant's own API key.
 *
 * What is genuinely available, and what is not, decides the shape of this file.
 * The Payments API returns every payment with the `fee` Razorpay took and the
 * `tax` inside that fee, per transaction — which is the entire substance of the
 * gateway-fee line a CA reconciles. What is *not* available on any API this key
 * can call is Razorpay's own monthly tax invoice PDF; that lives in the
 * dashboard under Account & Settings → Invoices. So this fetches the figures,
 * totals them into a statement, and the vault goes on asking for the PDF.
 *
 * Authentication is HTTP Basic with the key id as the user and the key secret as
 * the password — the same pair the checkout uses, and a **read** of it is all
 * this needs. The key never leaves the server.
 */

const BASE = "https://api.razorpay.com/v1";

/** Basic auth, built here rather than by `fetch`, which has no credential store. */
const auth = ({ keyId, keySecret }: Credentials) => ({
  authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`
});

/**
 * Razorpay windows on `created_at`, in **seconds** since the epoch rather than
 * milliseconds. Passing milliseconds is accepted and returns nothing, which is
 * indistinguishable from a quiet month — so the conversion is done in one place.
 */
const seconds = (at: Date) => Math.floor(at.getTime() / 1000);

type Payment = {
  id?: string;
  amount?: number;
  fee?: number;
  tax?: number;
  currency?: string;
  status?: string;
  method?: string;
  created_at?: number;
  description?: string;
};

/**
 * Every payment in the month.
 *
 * Paged at a hundred, which is Razorpay's ceiling, and stopped at fifty pages so
 * a busy month cannot run the function out of time. The cap is reported rather
 * than silently applied — a statement missing the last four hundred transactions
 * would tie to nothing.
 */
async function fetchPayments(credentials: Credentials, period: string): Promise<{ rows: Payment[]; capped: boolean }> {
  const { $gte, $lte } = periodRange(period);
  const rows: Payment[] = [];
  const MAX_PAGES = 50;

  let page = 0;
  for (; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      from: String(seconds($gte)),
      to: String(seconds($lte)),
      count: "100",
      skip: String(page * 100)
    });

    const { data } = await httpJson<{ items?: Payment[]; count?: number }>({
      service: "Razorpay", url: `${BASE}/payments?${query}`, headers: auth(credentials)
    });

    const batch = data.items ?? [];
    rows.push(...batch);
    if (batch.length < 100) return { rows, capped: false };
  }

  return { rows, capped: true };
}

export const razorpay: Connector = {
  key: "razorpay",
  label: "Razorpay",
  consoleUrl: "https://dashboard.razorpay.com/app/website-app-settings/api-keys",
  guidance:
    "Dashboard → Account & Settings → API Keys → Generate Key. The secret is shown once, so copy it then. "
    + "A read-only key is enough — nothing here writes to Razorpay.",
  fields: [
    { name: "keyId", label: "Key ID", secret: false, required: true, placeholder: "rzp_live_XXXXXXXXXXXX" },
    { name: "keySecret", label: "Key secret", secret: true, required: true, hint: "Shown once when the key is generated" }
  ],

  /**
   * A one-row read rather than a dedicated ping, Razorpay having no such
   * endpoint. `count=1` is the cheapest thing that proves the key is real and
   * has the permission this connector needs.
   */
  async test(credentials) {
    const { data } = await httpJson<{ count?: number }>({
      service: "Razorpay", url: `${BASE}/payments?count=1`, headers: auth(credentials)
    });
    return data.count === undefined
      ? "Connected to Razorpay, though it returned no payment count."
      : "Connected to Razorpay.";
  },

  async fetch(credentials, period): Promise<FetchResult> {
    const { rows, capped } = await fetchPayments(credentials, period);

    /*
     * Only captured payments carry a fee.
     *
     * An authorised-but-not-captured payment, and a failed one, both come back
     * in the list with `fee: null` — counting them would inflate the transaction
     * count on a statement whose whole purpose is to tie to a bank line.
     */
    const charged = rows.filter(row => row.status === "captured");

    if (!charged.length) {
      return {
        documents: [],
        message: rows.length
          ? `Razorpay returned ${rows.length} payment${rows.length === 1 ? "" : "s"} for ${formatPeriod(period)}, none of them captured — so there are no fees to state.`
          : `Razorpay collected nothing in ${formatPeriod(period)}.`
      };
    }

    const fees = charged.map(row => fromPaise(row.fee));
    const taxes = charged.map(row => fromPaise(row.tax));
    const totalFee = sumRupees(fees);
    const totalTax = sumRupees(taxes);

    const { from, to } = periodDays(period);
    const data = buildStatement({
      vendor: "Razorpay — gateway fees",
      period,
      columns: ["Payment ID", "Date", "Method", "Amount collected", "Fee", "Tax in fee", "Currency", "Description"],
      rows: charged.map((row, index) => [
        row.id ?? "",
        row.created_at ? new Date(row.created_at * 1000).toISOString().slice(0, 10) : "",
        row.method ?? "",
        fromPaise(row.amount),
        fees[index],
        taxes[index],
        row.currency ?? "INR",
        row.description ?? ""
      ]),
      totals: { amount: totalFee, taxAmount: totalTax },
      note: capped
        ? "TRUNCATED: more than 5,000 payments in this month; only the first 5,000 are listed."
        : undefined
    });

    return {
      documents: [{
        externalRef: `razorpay:fees:${period}`,
        fileName: `razorpay-fees-${period}.csv`,
        contentType: "text/csv",
        data,
        description: `Gateway fees on ${charged.length} payment${charged.length === 1 ? "" : "s"} (${from} to ${to})`,
        amount: totalFee,
        taxAmount: totalTax
      }],
      message: [
        `Razorpay: ${charged.length} captured payment${charged.length === 1 ? "" : "s"} in ${formatPeriod(period)}, ₹${totalFee.toLocaleString("en-IN")} in fees of which ₹${totalTax.toLocaleString("en-IN")} tax.`,
        capped ? "More than 5,000 payments — the statement is truncated." : "",
        "Razorpay's own tax invoice is dashboard-only; file that PDF as well."
      ].filter(Boolean).join(" ")
    };
  }
};

/** Razorpay answers a wrong key with a 401 whose body says nothing useful. */
export const razorpayHint = (error: unknown) =>
  error instanceof IntegrationError && error.status === 401
    ? "Razorpay refused the key. Check the key ID and secret, and that the key has not been regenerated."
    : null;
