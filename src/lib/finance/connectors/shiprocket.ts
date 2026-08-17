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
    "Nothing to enter. The vault uses the API user already held under Sales CRM → Settings, which is the "
    + "same account that books the parcels these invoices belong to. Fill the fields in only to point the "
    + "vault at a different Shiprocket account — Settings → API → Configure creates one, and it is a "
    + "separate login from the one a person signs in with.",
  fields: [
    { name: "email", label: "API user email", secret: false, required: true, placeholder: "Using the Sales CRM's API user" },
    { name: "password", label: "API user password", secret: true, required: true, hint: "Only for a different Shiprocket account" }
  ],

  /**
   * The API user the affiliate side already signs in with.
   *
   * The invoices this connector fetches belong to parcels *this application*
   * booked, with these credentials. A second copy of them in the vault would be
   * a second thing to rotate and a way for the two halves to disagree about
   * which Shiprocket account the company uses.
   */
  inherits: {
    from: "Sales CRM → Settings",
    async load() {
      const { loadCredentials, shiprocketConfig } = await import("@/lib/sales/settings");
      const config = shiprocketConfig(await loadCredentials());
      return config ? { email: config.email, password: config.password } : null;
    }
  },

  async test(credentials) {
    await login({ email: credentials.email, password: credentials.password });
    return "Connected to Shiprocket.";
  },

  async fetch() {
    throw new Error("Shiprocket is fetched by lib/finance/pull.ts, which needs the order records too.");
  }
};
