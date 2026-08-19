import { describe, expect, it } from "vitest";
import {
  advances, cleanParameter, parameterCount, previewMetaBody, ruleMatches, ruleSchema,
  statusFromMeta, templateValues
} from "./automation";
import { parseWebhook, stopsTheRun, verifySignature } from "./whatsapp";
import { IntegrationError } from "./http";
import { createHmac } from "node:crypto";

const parlour = { name: "Glow Beauty Studio", area: "Indirapuram", city: "Ghaziabad", type: "Beauty parlour" };

describe("Meta template blanks", () => {
  it("counts the highest numbered blank, not how many there are", () => {
    expect(parameterCount("Hi {{1}}, we work in {{3}} near {{2}}.")).toBe(3);
    expect(parameterCount("No blanks at all")).toBe(0);
  });

  it("fills numbered blanks from the mapped lead fields, in order", () => {
    const values = templateValues(["name", "city"], parlour);
    expect(previewMetaBody("Hi {{1}}, greetings from {{2}}!", values))
      .toBe("Hi Glow Beauty Studio, greetings from Ghaziabad!");
  });

  it("falls back the way the manual queue does when a field is empty", () => {
    // `area` on a lead with no area or city becomes "your area" — Meta refuses
    // an empty parameter outright, so the fallback is what keeps the send alive.
    expect(templateValues(["area"], { name: "X" })).toEqual(["your area"]);
  });

  it("leaves a blank standing when no value was mapped for it", () => {
    expect(previewMetaBody("Hi {{1}} and {{2}}", ["Glow"])).toBe("Hi Glow and {{2}}");
  });

  it("scrubs what Meta refuses out of a parameter", () => {
    expect(cleanParameter("Glow\nBeauty\t Studio")).toBe("Glow Beauty Studio");
    expect(cleanParameter("too      many spaces")).toBe("too many spaces");
    // Never empty — Meta refuses that too.
    expect(cleanParameter("  \n ")).toBe("-");
  });
});

describe("which leads a rule fires for", () => {
  it("matches case-blind on type and city", () => {
    expect(ruleMatches({ leadType: "beauty parlour", city: "ghaziabad" }, parlour)).toBe(true);
  });

  it("an empty filter matches everything", () => {
    expect(ruleMatches({}, parlour)).toBe(true);
    expect(ruleMatches({ leadType: "", city: "  " }, parlour)).toBe(true);
  });

  it("a filled filter excludes what it names away", () => {
    expect(ruleMatches({ leadType: "Chemist" }, parlour)).toBe(false);
    expect(ruleMatches({ city: "Noida" }, parlour)).toBe(false);
  });

  it("a disabled rule matches nobody", () => {
    expect(ruleMatches({ enabled: false }, parlour)).toBe(false);
  });
});

describe("status reports from Meta", () => {
  it("maps Meta's words onto ours and ignores what it does not know", () => {
    expect(statusFromMeta("delivered")).toBe("Delivered");
    expect(statusFromMeta("warning")).toBeNull();
  });

  it("only ever moves a message forward", () => {
    expect(advances("Sent", "Delivered")).toBe(true);
    // A `delivered` arriving after `read` — Meta delivers out of order sometimes.
    expect(advances("Read", "Delivered")).toBe(false);
    expect(advances("Sent", "Sent")).toBe(false);
  });

  it("does not let a late failure overwrite a delivery", () => {
    expect(advances("Delivered", "Failed")).toBe(false);
    expect(advances("Sent", "Failed")).toBe(true);
  });
});

describe("the rule schema", () => {
  it("accepts a complete rule", () => {
    const parsed = ruleSchema.parse({
      name: "Parlour invitation",
      leadType: "Beauty parlour",
      city: "Ghaziabad",
      template: { name: "partner_invite", language: "en", body: "Hi {{1}}", fields: ["name"] }
    });
    expect(parsed.enabled).toBe(true);
    expect(parsed.freshOnly).toBe(true);
  });

  it("refuses a rule with no template", () => {
    expect(() => ruleSchema.parse({ name: "Nameless", template: { name: "", language: "en" } })).toThrow();
  });

  it("refuses a merge field nothing will ever fill", () => {
    expect(() => ruleSchema.parse({
      name: "Bad mapping",
      template: { name: "t", language: "en", fields: ["owner"] }
    })).toThrow();
  });
});

describe("which errors stop a run", () => {
  it("a recipient problem does not", () => {
    expect(stopsTheRun(new IntegrationError("WhatsApp", "not on whatsapp", 400))).toBe(false);
  });
  it("the token, the rate limit and an outage do", () => {
    for (const status of [401, 403, 429, 500, 503]) {
      expect(stopsTheRun(new IntegrationError("WhatsApp", "stop", status))).toBe(true);
    }
  });
  it("a plain error does not — it is one row's problem", () => {
    expect(stopsTheRun(new Error("boom"))).toBe(false);
  });
});

describe("the webhook", () => {
  const secret = "app-secret";
  const sign = (body: string) => `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

  it("accepts Meta's signature and refuses anything else", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    expect(verifySignature(body, sign(body), secret)).toBe(true);
    expect(verifySignature(body, sign(body + " "), secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, sign(body), "")).toBe(false);
  });

  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "111" },
          contacts: [{ wa_id: "919650306893", profile: { name: "Glow" } }],
          statuses: [
            { id: "wamid.A", status: "delivered", timestamp: "1755600000", recipient_id: "919650306893" },
            { id: "wamid.B", status: "failed", recipient_id: "919999999999", errors: [{ code: 131026, title: "Undeliverable" }] }
          ],
          messages: [
            { id: "wamid.C", from: "919650306893", timestamp: "1755600100", type: "text", text: { body: "Yes, interested!" }, context: { id: "wamid.A" } }
          ]
        }
      }]
    }]
  };

  it("reads statuses and replies out of one post", () => {
    const { statuses, inbound } = parseWebhook(payload);
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ messageId: "wamid.A", status: "delivered", recipient: "919650306893" });
    expect(statuses[1].error).toContain("Undeliverable");
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({ from: "919650306893", text: "Yes, interested!", profileName: "Glow", inReplyTo: "wamid.A" });
  });

  it("ignores traffic for a different number on the same app", () => {
    const { statuses, inbound } = parseWebhook(payload, "222");
    expect(statuses).toHaveLength(0);
    expect(inbound).toHaveLength(0);
  });

  it("shrugs at a payload it does not recognise rather than throwing", () => {
    expect(parseWebhook({ object: "page", entry: "nonsense" })).toEqual({ statuses: [], inbound: [] });
    expect(parseWebhook(null)).toEqual({ statuses: [], inbound: [] });
  });

  it("describes a non-text message rather than losing it", () => {
    const { inbound } = parseWebhook({
      entry: [{ changes: [{ value: { messages: [{ id: "wamid.D", from: "911234567890", type: "image" }] } }] }]
    });
    expect(inbound[0].text).toBe("[image]");
  });
});
