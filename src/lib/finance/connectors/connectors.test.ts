import { describe, expect, it } from "vitest";
import { ALL_CONNECTORS, connectorFor } from "./index";
import { CONNECTORS, SOURCES, sourceOf } from "../sources";

/**
 * The registry's own consistency, which is the sort of thing that breaks when a
 * fifth vendor is added at half past six on a Friday.
 *
 * None of this calls a vendor. What it checks is that the four connectors and
 * the seven sources still describe the same world — a source pointing at a
 * connector that does not exist, or a connector whose fields the settings screen
 * cannot render, fails at runtime in front of somebody rather than here.
 */
describe("the connector registry", () => {
  it("has one connector for every key, under its own key", () => {
    expect(ALL_CONNECTORS).toHaveLength(CONNECTORS.length);
    for (const key of CONNECTORS) expect(connectorFor(key).key).toBe(key);
  });

  it("gives every connector somewhere to go and something to read", () => {
    for (const connector of ALL_CONNECTORS) {
      expect(connector.label, `${connector.key} has no label`).toBeTruthy();
      expect(connector.consoleUrl, `${connector.key} has no console URL`).toMatch(/^https:\/\//);
      // The guidance is what somebody follows to generate the key. A connector
      // without it is a form with no instructions.
      expect(connector.guidance.length, `${connector.key} has no guidance`).toBeGreaterThan(40);
    }
  });

  it("declares at least one required secret per connector", () => {
    // A connector with no secret is either misconfigured or does not need
    // credentials at all — and if the latter, it does not belong on a screen
    // whose entire purpose is holding keys. On a connector that inherits, this
    // is what a *complete override* needs, not what somebody must type.
    for (const connector of ALL_CONNECTORS) {
      const secrets = connector.fields.filter(field => field.secret && field.required);
      expect(secrets.length, `${connector.key} asks for no secret`).toBeGreaterThan(0);
    }
  });

  it("gives the two suppliers already connected elsewhere somewhere to borrow from", () => {
    /*
     * Shopify is the reason this exists. Shopify stopped issuing the pasteable
     * `shpat_` tokens a credential form expects — a Dev Dashboard app earns its
     * token through the OAuth handshake and never shows it again — so there is
     * nothing a person *can* type, and the only working credential is the one
     * the Sales CRM already holds. Shiprocket borrows for a plainer reason: the
     * invoices are for parcels booked with that very account.
     */
    expect(connectorFor("shopify").inherits?.from).toBe("Sales CRM → Settings");
    expect(connectorFor("shiprocket").inherits?.from).toBe("Sales CRM → Settings");
    // Razorpay and Meta have no such connection anywhere in the application.
    expect(connectorFor("razorpay").inherits).toBeUndefined();
    expect(connectorFor("meta").inherits).toBeUndefined();
  });

  it("gives every field a unique name, since they key the stored map", () => {
    for (const connector of ALL_CONNECTORS) {
      const names = connector.fields.map(field => field.name);
      expect(new Set(names).size, `${connector.key} repeats a field name`).toBe(names.length);
    }
  });
});

describe("the sources and the connectors agree", () => {
  it("points every fetchable source at a connector that exists", () => {
    for (const source of SOURCES) {
      if (!source.connector) continue;
      expect(CONNECTORS, `${source.key} names an unknown connector`).toContain(source.connector);
      expect(connectorFor(source.connector)).toBeTruthy();
    }
  });

  it("marks a source as pullable exactly when it has a connector", () => {
    // The card's Fetch button is drawn from `connector` and the checklist reads
    // `collection`. The two disagreeing means a button that cannot work, or a
    // working fetch nobody is offered.
    for (const source of SOURCES) {
      expect(Boolean(source.connector), `${source.key} disagrees with itself`).toBe(source.collection === "pull");
    }
  });

  it("says what every fetchable source yields", () => {
    for (const source of SOURCES) {
      if (!source.connector) continue;
      expect(["document", "statement"], `${source.key} does not say what it yields`).toContain(source.yields);
    }
  });

  it("warns about the PDF on exactly the sources that only yield a statement", () => {
    /*
     * The rule the whole design turns on. A source whose fetch returns figures
     * rather than the vendor's invoice must go on asking for that invoice, or a
     * successful fetch reads as a finished month and somebody claims input
     * credit against a spreadsheet.
     */
    for (const source of SOURCES) {
      if (source.yields === "statement") {
        expect(source.stillNeedsPdf, `${source.key} yields a statement and does not say so`).toBeTruthy();
      } else {
        expect(source.stillNeedsPdf, `${source.key} warns about a PDF it does fetch`).toBeUndefined();
      }
    }
  });

  it("gives every source that a person has to fetch by hand somewhere to go", () => {
    for (const source of SOURCES) {
      if (source.key === "other") continue;
      expect(source.billingUrl, `${source.key} has no billing page to link to`).toMatch(/^https:\/\//);
    }
  });

  it("still knows Shiprocket is three different bills", () => {
    const shiprocket = SOURCES.filter(source => source.vendor === "Shiprocket");
    expect(shiprocket).toHaveLength(3);
    // And only the order invoices are fetchable, the other two being published
    // in Shiprocket's own panel and nowhere else.
    expect(shiprocket.filter(source => source.connector).map(source => source.key)).toEqual(["shiprocket-order"]);
    expect(sourceOf("shiprocket-order").yields).toBe("document");
  });
});
