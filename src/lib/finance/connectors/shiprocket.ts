import { login } from "@/lib/sales/shiprocket";
import type { Connector } from "./types";

/**
 * Shiprocket's order tax invoices.
 *
 * The one source of the four whose pull returns the vendor's **own document**
 * rather than a statement built from their figures — and it does so because this
 * application already books those parcels, so it already knows each order's
 * Shiprocket id and already calls the endpoint that renders their invoices.
 *
 * The fetch itself is not here. It lives in `lib/finance/pull.ts`, because it
 * reads `SalesOrder` and the Shiprocket credentials the affiliate settings
 * already hold — quite unlike the other three, which know nothing but their own
 * key. What is here is the half this file can honestly provide: the credential
 * fields and a test. `fetch` throws if it is ever called, which it is not; the
 * pull route dispatches Shiprocket to the existing function by name.
 */
export const shiprocket: Connector = {
  key: "shiprocket",
  label: "Shiprocket",
  consoleUrl: "https://app.shiprocket.in/api-user",
  guidance:
    "Settings → API → Configure, and create an API user. It is a separate login from the one a person "
    + "signs in with, and the password is set when it is created. The Sales CRM holds these already — "
    + "entering them here is only needed if the vault should use a different account.",
  fields: [
    { name: "email", label: "API user email", secret: false, required: true, placeholder: "api-user@yourcompany.com" },
    { name: "password", label: "API user password", secret: true, required: true }
  ],

  async test(credentials) {
    await login({ email: credentials.email, password: credentials.password });
    return "Connected to Shiprocket.";
  },

  async fetch() {
    throw new Error("Shiprocket is fetched by lib/finance/pull.ts, which needs the order records too.");
  }
};
