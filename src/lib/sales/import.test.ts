import { describe, expect, it } from "vitest";
import { amount, parseCsv, parseDate, toTable } from "./csv";
import { mapHeaders, missingFields, readImport, toOrder } from "./import";

describe("parseCsv", () => {
  it("reads a plain file", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps a comma that lives inside a quoted field", () => {
    // The case that silently shifts every later column when you split on commas
    // — and here that means reading a discount as a total.
    expect(parseCsv('name,city\n"Kumar, R",Patna')).toEqual([["name", "city"], ["Kumar, R", "Patna"]]);
  });

  it("reads a doubled quote as one literal quote", () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([["a"], ['He said "hi"']]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([["a", "b"], ["line1\nline2", "x"]]);
  });

  it("handles Windows line endings and a trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("drops a byte-order mark rather than gluing it to the first header", () => {
    expect(parseCsv("﻿Order ID,Total\n1,2")[0][0]).toBe("Order ID");
  });

  it("ignores blank rows", () => {
    expect(parseCsv("a,b\n\n1,2\n,\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("toTable", () => {
  it("names the columns", () => {
    const table = toTable("Order ID,Total\n#1042,1499");
    expect(table.headers).toEqual(["Order ID", "Total"]);
    expect(table.rows[0]).toEqual({ "Order ID": "#1042", Total: "1499" });
  });

  it("fills a short row rather than dropping the column", () => {
    expect(toTable("a,b,c\n1,2").rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });
});

describe("amount", () => {
  it("reads money however it was formatted", () => {
    expect(amount("₹ 1,499.00")).toBe(1499);
    expect(amount("800.00")).toBe(800);
    expect(amount("59.90")).toBe(59.9);
    expect(amount("-450")).toBe(-450);
  });

  it("is zero for a blank or unreadable cell", () => {
    expect(amount("")).toBe(0);
    expect(amount(undefined)).toBe(0);
    expect(amount("—")).toBe(0);
  });
});

describe("parseDate", () => {
  it("reads ISO", () => {
    expect(parseDate("2026-08-11")?.getMonth()).toBe(7);
    expect(parseDate("2026-08-11T14:30:00")?.getHours()).toBe(14);
  });

  it("reads day before month, because these exports are Indian", () => {
    // 03-08-2026 is the third of August, not the eighth of March. Guessing the
    // other way moves a third of all orders into the wrong month.
    const date = parseDate("03-08-2026");
    expect(date?.getDate()).toBe(3);
    expect(date?.getMonth()).toBe(7);
  });

  it("reads a slashed date with a time", () => {
    const date = parseDate("11/08/2026 10:30");
    expect(date?.getDate()).toBe(11);
    expect(date?.getMonth()).toBe(7);
    expect(date?.getHours()).toBe(10);
  });

  it("is nothing for a blank cell", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
});

describe("mapHeaders", () => {
  it("finds the columns a checkout export actually uses", () => {
    const mapping = mapHeaders(["Order ID", "Order Date", "Discount Name", "Discount Total", "Order Total", "Delivery Status"]);
    expect(mapping.orderName).toBe("Order ID");
    expect(mapping.couponCode).toBe("Discount Name");
    expect(mapping.discount).toBe("Discount Total");
    expect(mapping.total).toBe("Order Total");
    expect(mapping.deliveryStatus).toBe("Delivery Status");
  });

  it("does not let the total steal the discount's column", () => {
    // Both match on the word "total"; the more specific field must win, or the
    // discount is read as what was paid.
    const mapping = mapHeaders(["Order ID", "Discount Total", "Total"]);
    expect(mapping.discount).toBe("Discount Total");
    expect(mapping.total).toBe("Total");
  });

  it("ignores case, spaces and underscores", () => {
    const mapping = mapHeaders(["order_id", "COUPON CODE", "amount paid"]);
    expect(mapping.orderName).toBe("order_id");
    expect(mapping.couponCode).toBe("COUPON CODE");
    expect(mapping.total).toBe("amount paid");
  });

  it("says what is missing rather than importing half an order", () => {
    expect(missingFields(mapHeaders(["Order ID", "Total"]))).toEqual(["couponCode"]);
    expect(missingFields(mapHeaders(["Order ID", "Discount Name", "Total"]))).toEqual([]);
  });
});

describe("toOrder", () => {
  const mapping = mapHeaders(["Order ID", "Order Date", "Discount Name", "Discount Total", "Order Total", "Delivery Status"]);
  const row = (over: Record<string, string> = {}) => ({
    "Order ID": "1042", "Order Date": "2026-08-11", "Discount Name": "PINKY30",
    "Discount Total": "800.00", "Order Total": "1499.00", "Delivery Status": "DELIVERED", ...over
  });

  it("reconstructs the order the commission arithmetic expects", () => {
    const result = toOrder(row(), mapping);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.couponCode).toBe("PINKY30");
    expect(result.order.total).toBe(1499);
    expect(result.order.discount).toBe(800);
    expect(result.order.delivery).toBe("Delivered");
  });

  it("gives the order a name that matches how Shopify writes one", () => {
    const result = toOrder(row(), mapping);
    expect(result.ok && result.order.name).toBe("#1042");
  });

  it("does not double the hash where the export already has one", () => {
    const result = toOrder(row({ "Order ID": "#1042" }), mapping);
    if (result.ok) expect(result.order.name).toBe("#1042");
  });

  it("reads a negative discount as the amount it took off", () => {
    const result = toOrder(row({ "Discount Total": "-800.00" }), mapping);
    if (result.ok) expect(result.order.discount).toBe(800);
  });

  it("skips a row with no coupon, and says why", () => {
    const result = toOrder(row({ "Discount Name": "" }), mapping);
    expect(result).toEqual({ ok: false, reason: "no coupon on this order" });
  });

  it("skips an offer that belongs to nobody", () => {
    const result = toOrder(row({ "Discount Name": "FREE BAG" }), mapping);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/rep-shaped/);
  });

  it("skips a row with nothing paid", () => {
    expect(toOrder(row({ "Order Total": "0" }), mapping).ok).toBe(false);
  });
});

describe("readImport", () => {
  const csv = [
    "Order ID,Order Date,Discount Name,Discount Total,Order Total,Delivery Status",
    "1041,2026-08-10,SATHYA10,59.90,539.10,DELIVERED",
    "1042,2026-08-11,PINKY30,800.00,1499.00,IN TRANSIT",
    "1043,2026-08-11,PINKY30,800.00,1499.00,RTO DELIVERED",
    "1044,2026-08-11,FREE BAG,599.00,1200.00,DELIVERED",
    "1045,2026-08-12,,0,899.00,DELIVERED"
  ].join("\n");

  const table = toTable(csv);
  const summary = readImport(table.rows, mapHeaders(table.headers));

  it("takes the rows carrying a rep's coupon", () => {
    expect(summary.rows).toBe(5);
    expect(summary.usable).toBe(3);
    expect(summary.orders.map(order => order.couponCode)).toEqual(["SATHYA10", "PINKY30", "PINKY30"]);
  });

  it("accounts for every row it did not take", () => {
    // Silently importing 3 of 5 rows is how somebody is quietly underpaid.
    const total = summary.skipped.reduce((count, entry) => count + entry.count, 0);
    expect(total).toBe(2);
    expect(summary.skipped.map(entry => entry.reason).join(" ")).toMatch(/rep-shaped|no coupon/);
  });

  it("reads the delivery state each row will be priced on", () => {
    expect(summary.orders.map(order => order.delivery)).toEqual(["Delivered", "In transit", "RTO"]);
  });
});
