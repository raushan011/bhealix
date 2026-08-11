import { describe, expect, it } from "vitest";
import {
  appendFollowUp, applyFollowUps, followUpListSchema, nextFollowUp, setFollowUpDate,
  sortedFollowUps, syncFollowUpDate, type FollowUpLike
} from "./follow-ups";

/** A bill, reduced to the two fields these helpers touch. */
const bill = (followUps: FollowUpLike[] = []) =>
  ({ followUps, followUpDate: undefined as Date | undefined });

const on = (date: string) => new Date(`${date}T12:00:00`);
const iso = (value?: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

describe("nextFollowUp", () => {
  it("is the earliest chase nobody has made yet", () => {
    const list = [
      { date: on("2026-03-20") },
      { date: on("2026-03-05"), doneAt: on("2026-03-05") },
      { date: on("2026-03-12") }
    ];
    expect(iso(new Date(nextFollowUp(list)!.date))).toBe("2026-03-12");
  });

  it("keeps a missed chase as the next one rather than letting the bill go quiet", () => {
    const list = [{ date: on("2020-01-01") }, { date: on("2030-01-01") }];
    expect(iso(new Date(nextFollowUp(list)!.date))).toBe("2020-01-01");
  });

  it("is nothing at all once every chase has been made", () => {
    expect(nextFollowUp([{ date: on("2026-03-01"), doneAt: on("2026-03-01") }])).toBeUndefined();
    expect(nextFollowUp([])).toBeUndefined();
    expect(nextFollowUp(null)).toBeUndefined();
  });
});

describe("sortedFollowUps", () => {
  it("orders by the day they fall due, made or not", () => {
    const dates = sortedFollowUps([{ date: on("2026-05-01") }, { date: on("2026-04-01") }])
      .map(entry => iso(new Date(entry.date)));
    expect(dates).toEqual(["2026-04-01", "2026-05-01"]);
  });
});

describe("syncFollowUpDate", () => {
  it("mirrors the next outstanding chase into the field the lists sort on", () => {
    const invoice = bill([{ date: on("2026-06-10") }, { date: on("2026-06-01") }]);
    expect(iso(syncFollowUpDate(invoice).followUpDate)).toBe("2026-06-01");
  });

  it("clears the mirror when the last chase is marked made", () => {
    const invoice = bill([{ date: on("2026-06-01"), doneAt: on("2026-06-01") }]);
    expect(syncFollowUpDate(invoice).followUpDate).toBeUndefined();
  });
});

describe("applyFollowUps", () => {
  it("keeps who scheduled a chase, and when it was made, through an edit", () => {
    const made = on("2026-02-02");
    const invoice = bill([{ _id: "a1", date: on("2026-02-01"), doneAt: made, createdBy: "user-1" }]);

    applyFollowUps(invoice, [{ _id: "a1", date: "2026-02-05", note: "moved", done: true }], "user-2");

    expect(invoice.followUps).toHaveLength(1);
    const [entry] = invoice.followUps!;
    expect(iso(new Date(entry.date))).toBe("2026-02-05");
    expect(entry.note).toBe("moved");
    // The client sends a flag, never a timestamp: marking one made twice must not
    // move the day it was actually made on.
    expect(entry.doneAt).toBe(made);
    expect(entry.createdBy).toBe("user-1");
  });

  it("puts a chase back on the list without inventing a new one", () => {
    const invoice = bill([{ _id: "a1", date: on("2026-02-01"), doneAt: on("2026-02-02") }]);
    applyFollowUps(invoice, [{ _id: "a1", date: "2026-02-01", done: false }]);
    expect(invoice.followUps![0].doneAt).toBeUndefined();
    expect(iso(invoice.followUpDate)).toBe("2026-02-01");
  });

  it("credits a new chase to whoever added it, and re-mirrors the next date", () => {
    const invoice = bill([{ _id: "a1", date: on("2026-02-10") }]);
    applyFollowUps(invoice, [
      { _id: "a1", date: "2026-02-10" },
      { date: "2026-02-04", note: "promised the balance" }
    ], "user-9");

    expect(invoice.followUps![1].createdBy).toBe("user-9");
    expect(iso(invoice.followUpDate)).toBe("2026-02-04");
  });

  it("drops what the form no longer sends, and empties the mirror with it", () => {
    const invoice = bill([{ _id: "a1", date: on("2026-02-01") }]);
    applyFollowUps(invoice, []);
    expect(invoice.followUps).toEqual([]);
    expect(invoice.followUpDate).toBeUndefined();
  });

  it("leaves an unknown id as a chase of its own rather than losing the row", () => {
    const invoice = bill();
    applyFollowUps(invoice, [{ _id: "0".repeat(24), date: "2026-02-01" }]);
    expect(invoice.followUps).toHaveLength(1);
    expect(invoice.followUps![0]._id).toBeUndefined();
  });
});

describe("appendFollowUp", () => {
  it("adds one chase without disturbing the others", () => {
    const invoice = bill([{ _id: "a1", date: on("2026-07-20"), note: "first" }]);
    appendFollowUp(invoice, { date: "2026-07-01" }, "rep-1");

    expect(invoice.followUps).toHaveLength(2);
    expect(invoice.followUps![0].note).toBe("first");
    expect(iso(invoice.followUpDate)).toBe("2026-07-01");
  });
});

describe("setFollowUpDate", () => {
  it("moves the earliest outstanding chase rather than piling another on it", () => {
    const invoice = bill([{ _id: "a1", date: on("2026-08-01") }, { _id: "a2", date: on("2026-08-20") }]);
    setFollowUpDate(invoice, "2026-08-05");

    expect(invoice.followUps).toHaveLength(2);
    expect(iso(new Date(invoice.followUps![0].date))).toBe("2026-08-05");
    expect(iso(invoice.followUpDate)).toBe("2026-08-05");
  });

  it("schedules the first chase on a bill that had none", () => {
    const invoice = bill();
    setFollowUpDate(invoice, "2026-08-05", "admin-1");
    expect(invoice.followUps).toHaveLength(1);
    expect(invoice.followUps![0].createdBy).toBe("admin-1");
  });

  it("clearing drops what is outstanding and keeps the calls already made", () => {
    const invoice = bill([
      { _id: "a1", date: on("2026-08-01"), doneAt: on("2026-08-01") },
      { _id: "a2", date: on("2026-08-20") }
    ]);
    setFollowUpDate(invoice, null);

    expect(invoice.followUps).toHaveLength(1);
    expect(invoice.followUps![0]._id).toBe("a1");
    expect(invoice.followUpDate).toBeUndefined();
  });
});

describe("followUpListSchema", () => {
  it("takes a date, a note and a flag, and nothing else about the mark", () => {
    const parsed = followUpListSchema.parse([{ date: "2026-09-01", note: "  spaced  ", done: true }]);
    expect(parsed).toEqual([{ date: "2026-09-01", note: "spaced", done: true }]);
  });

  it("refuses a date that is not a date, and a list longer than anybody chases", () => {
    expect(() => followUpListSchema.parse([{ date: "01-09-2026" }])).toThrow();
    expect(() => followUpListSchema.parse(
      Array.from({ length: 21 }, () => ({ date: "2026-09-01" }))
    )).toThrow();
  });
});
