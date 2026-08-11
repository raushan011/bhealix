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

  it("accepts a coupon named anything, because a rep may be given one", () => {
    // Whether a code belongs to somebody is decided against the rep list, not
    // by the letters in it — a rep's coupon need not end in the rule's digits.
    const result = toOrder(row({ "Discount Name": "DIWALI SPECIAL" }), mapping);
    expect(result.ok && result.order.couponCode).toBe("DIWALI SPECIAL");
  });

  it("skips a row with nothing paid", () => {
    expect(toOrder(row({ "Order Total": "0" }), mapping).ok).toBe(false);
  });
});

describe("a real Fastrr checkout export", () => {
  // The header row and rows verbatim from an actual download, which is the only
  // way to know the aliases match the file rather than match a guess at it.
  const csv = [
    "platformOrderId,clientOrderId,fastrrOrderId,date,trackingId,paymentMode,orderAmount,partial paid amount,discountData,shippingDetails,deliveryMethod,promiseEdd,firstAttemptDate,rtoPrediction,mobileNo,courier,childCourier,orderFulfillmentStatus,source,tags,paymentGateway,pgTransactionId,refundedAmount,paymentStatus,firstName,lastName",
    '7205721407718,"#1789",357504693,2026-08-06T23:45:36.288,,cash_on_delivery,669.0,,,null null,Standard,2026-08-08T00:00,,low,6388403302,,,Unfulfilled,fastrr,"fastrr, low, SR_STANDARD, Standard",,Shydidly1786039944354,0.0,PENDING,Raushan,',
    '7214005715174,"#1790",361162777,2026-08-11T11:52:34.139,,partial_paid,2299.0,99.0,FREE BAG,null null,Standard,2026-08-13T00:00,,low,6388403302,,,Unfulfilled,fastrr,"fastrr, low, PPCOD",RAZORPAY,order_TOMRuKrtuapfK0,0.0,partial_paid,Raushan,',
    '7214067482854,"#1791",361223509,2026-08-11T13:03:22.010,,prepaid,1499.0,,SATHYA30,null null,Standard,2026-08-16T00:00,,low,8095341388,,,fulfilled,fastrr,"fastrr, low",RAZORPAY,order_TONf92Y5ptJJWV,0.0,CAPTURED,Deepthi,',
    '7214208057574,"#1792",361358998,2026-08-11T15:52:08.296,,partial_paid,1499.0,99.0,PINKY30,null null,Standard,2026-08-13T00:00,,low,6388403302,,,Unfulfilled,fastrr,"fastrr, low, PPCOD",RAZORPAY,order_TOQb1X5vYDDxos,0.0,partial_paid,Raushan,Upadhyay',
    '7214292369638,"#1794",361425895,2026-08-11T17:21:19.690,,prepaid,539.1,,SATHYA10,null null,Standard,2026-08-15T00:00,,low,9739828521,,,fulfilled,fastrr,"fastrr, low",RAZORPAY,order_TOS7y25oZSnAvk,0.0,CAPTURED,C.V,Nagaraja'
  ].join("\n");

  const table = toTable(csv);
  const mapping = mapHeaders(table.headers);
  const summary = readImport(table.rows, mapping);

  it("finds the columns this export actually uses", () => {
    expect(mapping.orderName).toBe("clientOrderId");
    expect(mapping.platformOrderId).toBe("platformOrderId");
    expect(mapping.couponCode).toBe("discountData");
    expect(mapping.total).toBe("orderAmount");
    expect(mapping.deliveryStatus).toBe("orderFulfillmentStatus");
    expect(mapping.customerPhone).toBe("mobileNo");
    expect(missingFields(mapping)).toEqual([]);
  });

  it("does not let 'partial paid amount' or 'refundedAmount' be read as the total", () => {
    // Both contain a money word; the order the aliases are tried in is what
    // keeps ₹99 from becoming the value of a ₹1,499 order.
    expect(mapping.total).toBe("orderAmount");
    expect(mapping.refunded).toBe("refundedAmount");
  });

  it("takes the coupon-carrying rows and skips the rest", () => {
    expect(summary.rows).toBe(5);
    expect(summary.orders.map(order => order.couponCode)).toEqual(["FREE BAG", "SATHYA30", "PINKY30", "SATHYA10"]);
    // #1789 carried no discount at all.
    expect(summary.skipped).toEqual([{ reason: "no coupon on this order", count: 1 }]);
  });

  it("reads what was charged, which is what commission is a share of", () => {
    const kit = summary.orders.find(order => order.couponCode === "SATHYA30")!;
    expect(kit.total).toBe(1499);        // 2,299 less the 800 the coupon took off
    expect(kit.name).toBe("#1791");
    expect(kit.platformOrderId).toBe("7214067482854");

    const single = summary.orders.find(order => order.couponCode === "SATHYA10")!;
    expect(single.total).toBe(539.1);    // 599 less 10%
  });

  it("never treats a fulfilment as a delivery", () => {
    // Every row here is either Unfulfilled or fulfilled, and not one of them
    // has been delivered. If any of these came back Delivered, the seven-day
    // hold would start on a parcel still in a van.
    expect(summary.orders.map(order => order.delivery)).toEqual(["Awaiting", "In transit", "Awaiting", "In transit"]);
    expect(summary.orders.some(order => order.delivery === "Delivered")).toBe(false);
  });

  it("joins the customer's name back together", () => {
    const order = summary.orders.find(order => order.couponCode === "PINKY30")!;
    expect(order.customer.name).toBe("Raushan Upadhyay");
    expect(order.customer.phone).toBe("6388403302");
  });

  it("keeps the quoted order name without its quotes", () => {
    expect(summary.orders.every(order => /^#\d+$/.test(order.name))).toBe(true);
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

  it("takes every row carrying a coupon of any name", () => {
    expect(summary.rows).toBe(5);
    expect(summary.usable).toBe(4);
    expect(summary.orders.map(order => order.couponCode)).toEqual(["SATHYA10", "PINKY30", "PINKY30", "FREE BAG"]);
  });

  it("accounts for every row it did not take", () => {
    // Silently importing 4 of 5 rows is how somebody is quietly underpaid.
    const total = summary.skipped.reduce((count, entry) => count + entry.count, 0);
    expect(total).toBe(1);
    expect(summary.skipped).toEqual([{ reason: "no coupon on this order", count: 1 }]);
  });

  it("reads the delivery state each row will be priced on", () => {
    expect(summary.orders.map(order => order.delivery)).toEqual(["Delivered", "In transit", "RTO", "Delivered"]);
  });
});
