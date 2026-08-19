import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_DELAYS, MAX_MESSAGE_LENGTH, WHATSAPP_APPS, advancesOnSend, buildQueue, clampAutopilotDelay,
  render, templateSchema, templateUpdateSchema, unknownFields, whatsappAndroidUrl, whatsappAppUrl,
  whatsappSendUrl, whatsappWebUrl
} from "./outreach";

const parlour = {
  _id: "a1",
  name: "Glow Beauty Studio",
  area: "Indirapuram",
  city: "Ghaziabad",
  type: "Beauty parlour",
  phone: "096503 06893"
};

describe("rendering a message", () => {
  it("drops every known field into the sentence", () => {
    expect(render("Hi {{name}}, we work with each {{type}} in {{area}}, {{city}}.", parlour))
      .toBe("Hi Glow Beauty Studio, we work with each beauty parlour in Indirapuram, Ghaziabad.");
  });

  it("lower-cases the type, which reads as a noun mid-sentence", () => {
    expect(render("for a {{type}}", parlour)).toBe("for a beauty parlour");
  });

  it("tolerates spaces inside the braces", () => {
    expect(render("Hi {{ name }}", parlour)).toBe("Hi Glow Beauty Studio");
  });

  it("replaces every occurrence, not just the first", () => {
    expect(render("{{name}} — yes, {{name}}", parlour)).toBe("Glow Beauty Studio — yes, Glow Beauty Studio");
  });

  it("falls back to the city when Google published no locality", () => {
    expect(render("in {{area}}", { ...parlour, area: "" })).toBe("in Ghaziabad");
  });

  it("falls back to a general phrase when it has neither", () => {
    expect(render("in {{area}}", { ...parlour, area: "", city: "" })).toBe("in your area");
  });

  it("never leaves a dangling preposition when a field is missing", () => {
    const message = render("We work with parlours in {{area}}.", { name: "X" });
    expect(message).not.toContain("in .");
    expect(message).toBe("We work with parlours in your area.");
  });

  it("greets an unnamed lead as 'there' rather than emptiness", () => {
    expect(render("Hi {{name}},", { name: "" })).toBe("Hi there,");
  });

  it("leaves an unknown placeholder standing so the preview shows the mistake", () => {
    expect(render("Hi {{owner}}", parlour)).toBe("Hi {{owner}}");
  });

  it("reports which placeholders nothing will ever fill", () => {
    expect(unknownFields("{{name}} {{owner}} {{gst}} {{owner}}")).toEqual(["owner", "gst"]);
    expect(unknownFields("{{name}} in {{city}}")).toEqual([]);
  });
});

describe("the WhatsApp link", () => {
  it("normalises an Indian number and carries the message", () => {
    expect(whatsappSendUrl("096503 06893", "Hi there"))
      .toBe("https://wa.me/919650306893?text=Hi%20there");
  });

  it("escapes what would otherwise break the query string", () => {
    const url = whatsappSendUrl("9650306893", "50% off & free delivery?")!;
    expect(url).toContain("50%25%20off%20%26%20free%20delivery%3F");
  });

  it("survives newlines and emoji, which templates really do contain", () => {
    const url = whatsappSendUrl("9650306893", "Hi 👋\nTwo lines")!;
    expect(url).toContain("%0A");
    expect(decodeURIComponent(url.split("?text=")[1])).toBe("Hi 👋\nTwo lines");
  });

  it("still opens the chat when there is no message to prefill", () => {
    expect(whatsappSendUrl("9650306893", "   ")).toBe("https://wa.me/919650306893");
  });

  it("refuses a number nobody can be reached on", () => {
    expect(whatsappSendUrl("call the shop", "Hi")).toBeNull();
    expect(whatsappSendUrl("", "Hi")).toBeNull();
    expect(whatsappSendUrl(null, "Hi")).toBeNull();
  });
});

describe("the app link", () => {
  it("hands the phone a scheme the OS routes, not a page to navigate to", () => {
    expect(whatsappAppUrl("096503 06893", "Hi there"))
      .toBe("whatsapp://send?phone=919650306893&text=Hi%20there");
  });

  it("normalises the number exactly as the web link does", () => {
    const number = (url: string) => url.match(/phone=(\d+)/)![1];
    expect(number(whatsappAppUrl("0120-4567890", "Hi")!))
      .toBe(number(whatsappSendUrl("0120-4567890", "Hi")!.replace("https://wa.me/", "phone=")));
  });

  it("escapes the message the same way", () => {
    expect(whatsappAppUrl("9650306893", "50% off & free?")!)
      .toContain("text=50%25%20off%20%26%20free%3F");
  });

  it("drops the text parameter rather than sending an empty one", () => {
    expect(whatsappAppUrl("9650306893", "   ")).toBe("whatsapp://send?phone=919650306893");
  });

  it("refuses the same numbers the web link refuses", () => {
    expect(whatsappAppUrl("call the shop", "Hi")).toBeNull();
    expect(whatsappAppUrl(null, "Hi")).toBeNull();
  });
});

describe("the queue", () => {
  const template = "Hi {{name}}, we work with parlours in {{area}}.";

  it("renders each lead separately rather than once for the batch", () => {
    const queue = buildQueue([
      parlour,
      { _id: "b2", name: "Bella Salon", area: "Vaishali", city: "Ghaziabad", phone: "9811111111" }
    ], template);

    expect(queue[0].message).toBe("Hi Glow Beauty Studio, we work with parlours in Indirapuram.");
    expect(queue[1].message).toBe("Hi Bella Salon, we work with parlours in Vaishali.");
  });

  it("keeps an unreachable lead in the queue, with no link", () => {
    const queue = buildQueue([{ _id: "c3", name: "No Number Nails", phone: "" }], template);
    expect(queue).toHaveLength(1);
    expect(queue[0].url).toBeNull();
    expect(queue[0].message).toContain("No Number Nails");
  });

  it("holds the queue's length to the list it was given", () => {
    expect(buildQueue([], template)).toEqual([]);
  });
});

describe("what a send does to the status", () => {
  it("moves a lead nobody has touched", () => {
    expect(advancesOnSend("New")).toBe(true);
  });

  it("never drags an earned status backwards", () => {
    expect(advancesOnSend("Interested")).toBe(false);
    expect(advancesOnSend("Not interested")).toBe(false);
    expect(advancesOnSend("Contacted")).toBe(false);
  });
});

describe("saving a template", () => {
  const base = { name: "Parlour intro", body: "Hi {{name}}, we work with parlours in {{area}}." };

  it("accepts a workable template", () => {
    expect(templateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a message too short to be one", () => {
    expect(templateSchema.safeParse({ ...base, body: "Hi" }).success).toBe(false);
  });

  it("rejects a message WhatsApp would cut off", () => {
    expect(templateSchema.safeParse({ ...base, body: "x".repeat(MAX_MESSAGE_LENGTH + 1) }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, body: "x".repeat(MAX_MESSAGE_LENGTH) }).success).toBe(true);
  });

  it("requires a name worth recognising", () => {
    expect(templateSchema.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  it("refuses an update that changes nothing", () => {
    expect(templateUpdateSchema.safeParse({}).success).toBe(false);
    expect(templateUpdateSchema.safeParse({ body: base.body }).success).toBe(true);
  });
});

describe("choosing which WhatsApp opens", () => {
  it("names the package on Android, so the choice is honoured and not the phone's default", () => {
    const url = whatsappAndroidUrl(parlour.phone, "Hi", "business");
    expect(url).toBe("intent://send?phone=919650306893&text=Hi#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end");
    expect(whatsappAndroidUrl(parlour.phone, "Hi", "personal")).toContain("package=com.whatsapp;end");
  });

  it("falls back to the plain scheme when the phone's own default is wanted", () => {
    expect(whatsappAndroidUrl(parlour.phone, "Hi", "default"))
      .toBe(whatsappAppUrl(parlour.phone, "Hi"));
  });

  it("stays unsendable for a number that cannot be made sense of", () => {
    expect(whatsappAndroidUrl("call the shop", "Hi", "business")).toBeNull();
  });

  it("offers the business app before the personal one — this is a business queue", () => {
    expect(WHATSAPP_APPS[0].value).toBe("default");
    expect(WHATSAPP_APPS[1].value).toBe("business");
  });
});

describe("the autopilot's own pieces", () => {
  it("opens the chat inside WhatsApp Web, skipping the wa.me interstitial", () => {
    expect(whatsappWebUrl(parlour.phone, "Hi there"))
      .toBe("https://web.whatsapp.com/send?phone=919650306893&text=Hi%20there");
  });

  it("stays unsendable for a number that cannot be made sense of", () => {
    expect(whatsappWebUrl("ask at the counter", "Hi")).toBeNull();
  });

  it("boxes the pace into something a human is actually pressing Enter at", () => {
    expect(clampAutopilotDelay(1)).toBe(AUTOPILOT_DELAYS.min);
    expect(clampAutopilotDelay(600)).toBe(AUTOPILOT_DELAYS.max);
    expect(clampAutopilotDelay(12)).toBe(12);
    expect(clampAutopilotDelay(Number.NaN)).toBe(AUTOPILOT_DELAYS.fallback);
  });
});
