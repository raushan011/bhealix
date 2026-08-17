import { describe, expect, it } from "vitest";
import { buildRound, byProgress, describeState, tallySamples, type RoundVisitInput } from "./rounds";

/** "11:20" on a fixed day, so the arithmetic is readable in the assertions. */
const clock = (time: string) => new Date(`2026-08-14T${time}:00+05:30`);

const call = (over: Partial<RoundVisitInput> & { id: string }): RoundVisitInput => ({
  status: "Completed",
  routePlan: "plan-1",
  doctor: { id: `d-${over.id}`, name: `Doctor ${over.id}` },
  ...over
});

const round = (visits: RoundVisitInput[]) =>
  buildRound({ employeeId: "e1", employeeName: "Asha Rao", date: "2026-08-14", visits });

describe("the order a day is told in", () => {
  it("follows what actually happened, not what was planned", () => {
    /*
     * The whole point of the screen. A rep who took the third clinic first
     * should read that way — straightening them back into the plan is how a desk
     * comes to believe a round is on schedule when it is not.
     */
    const built = round([
      call({ id: "a", plannedStart: "09:30", checkInAt: clock("12:10"), checkOutAt: clock("12:40") }),
      call({ id: "b", plannedStart: "11:00", checkInAt: clock("09:45"), checkOutAt: clock("10:20") })
    ]);

    expect(built.visits.map(visit => visit.id)).toEqual(["b", "a"]);
    expect(built.visits.map(visit => visit.position)).toEqual([1, 2]);
  });

  it("puts what has not happened yet after what has, in planned order", () => {
    const built = round([
      call({ id: "later", status: "Planned", plannedStart: "16:00" }),
      call({ id: "done", checkInAt: clock("09:45"), checkOutAt: clock("10:15") }),
      call({ id: "next", status: "Planned", plannedStart: "14:00" })
    ]);
    expect(built.visits.map(visit => visit.id)).toEqual(["done", "next", "later"]);
  });

  it("sorts a call with no planned time last rather than into the morning", () => {
    const built = round([
      call({ id: "untimed", status: "Planned" }),
      call({ id: "timed", status: "Planned", plannedStart: "15:00" })
    ]);
    expect(built.visits.map(visit => visit.id)).toEqual(["timed", "untimed"]);
  });
});

describe("time worked", () => {
  it("runs from the first call to the last recorded action", () => {
    const built = round([
      call({ id: "a", checkInAt: clock("09:30"), checkOutAt: clock("10:15") }),
      call({ id: "b", checkInAt: clock("11:00"), checkOutAt: clock("11:40") })
    ]);

    expect(built.workedMinutes).toBe(130);        // 09:30 → 11:40
    expect(built.inClinicMinutes).toBe(85);       // 45 + 40
    expect(built.betweenMinutes).toBe(45);        // travel and waiting
    expect(built.averageCallMinutes).toBe(43);
    expect(built.measuredCalls).toBe(2);
  });

  it("does not keep accumulating after the rep stopped recording", () => {
    /*
     * Measured to the last stamp rather than to "now". A rep whose last
     * check-out was at two would otherwise be shown gaining working hours all
     * evening, and the figure would describe the reader's clock rather than the
     * rep's day.
     */
    const built = round([call({ id: "a", checkInAt: clock("09:00"), checkOutAt: clock("09:40") })]);
    expect(built.workedMinutes).toBe(40);
    expect(built.betweenMinutes).toBe(0);
  });

  it("measures the gap between calls from where the last one ended", () => {
    const built = round([
      call({ id: "a", checkInAt: clock("09:30"), checkOutAt: clock("10:00") }),
      call({ id: "b", checkInAt: clock("10:50"), checkOutAt: clock("11:20") })
    ]);
    expect(built.visits[0].gapMinutes).toBeUndefined();   // nothing before the first
    expect(built.visits[1].gapMinutes).toBe(50);
  });

  it("leaves a call still open out of the in-clinic total but keeps it in the day", () => {
    // A rep checked in and has not closed the visit — very ordinary at the
    // moment somebody looks at this screen.
    const built = round([
      call({ id: "done", checkInAt: clock("09:30"), checkOutAt: clock("10:00") }),
      call({ id: "open", status: "In progress", checkInAt: clock("10:30") })
    ]);

    expect(built.total).toBe(2);
    expect(built.measuredCalls).toBe(1);
    expect(built.inClinicMinutes).toBe(30);
    // The span still reaches the open call's check-in, so the day is not
    // understated while somebody is sitting in a waiting room.
    expect(built.workedMinutes).toBe(60);
    expect(built.visits[1].minutes).toBeUndefined();
  });

  it("never reports a negative afternoon from crossed timestamps", () => {
    const built = round([
      call({ id: "a", checkInAt: clock("09:00"), checkOutAt: clock("12:00") }),
      call({ id: "b", checkInAt: clock("09:30"), checkOutAt: clock("10:00") })
    ]);
    expect(built.betweenMinutes).toBeGreaterThanOrEqual(0);
  });

  it("reports nothing rather than zero when nobody has set off", () => {
    const built = round([call({ id: "a", status: "Planned", plannedStart: "09:30" })]);
    expect(built.workedMinutes).toBe(0);
    expect(built.firstCheckInAt).toBeUndefined();
    expect(built.averageCallMinutes).toBeUndefined();
  });
});

describe("how far the rep went", () => {
  // Two points about 4.3 km apart in north-east Delhi, and one across the city.
  const saboli = { latitude: 28.7092, longitude: 77.2731 };
  const gokalpur = { latitude: 28.6959, longitude: 77.2895 };
  const dwarka = { latitude: 28.5921, longitude: 77.0460 };

  it("measures each leg from where the rep actually checked in", () => {
    const built = round([
      call({ id: "a", checkInAt: clock("09:30"), checkOutAt: clock("10:00"), checkInLocation: saboli }),
      call({ id: "b", checkInAt: clock("10:40"), checkOutAt: clock("11:10"), checkInLocation: gokalpur })
    ]);

    expect(built.visits[0].distanceKm).toBeUndefined();   // nothing before the first
    expect(built.visits[1].distanceKm).toBeCloseTo(2.2, 0);
    expect(built.visits[1].distanceFrom).toBe("checked-in");
  });

  it("falls back to the clinic's own coordinate when the phone had no fix", () => {
    // Basements happen. A leg measured from a registered address is still worth
    // having, and is labelled so nobody reads it as evidence of being there.
    const built = round([
      call({ id: "a", checkInAt: clock("09:30"), checkOutAt: clock("10:00"), checkInLocation: saboli }),
      call({ id: "b", checkInAt: clock("11:00"), checkOutAt: clock("11:30"),
        doctor: { id: "d-b", name: "Doctor b", location: dwarka } })
    ]);

    expect(built.visits[1].distanceKm).toBeGreaterThan(20);
    expect(built.visits[1].distanceFrom).toBe("registered");
  });

  it("refuses Null Island, which is what a phone with no fix sometimes writes", () => {
    /*
     * 0°, 0° is in the Gulf of Guinea. Taken at face value it would put six
     * thousand kilometres between two clinics on the same street — and the day's
     * total would be a number somebody might actually act on.
     */
    const built = round([
      call({ id: "a", checkInAt: clock("09:30"), checkOutAt: clock("10:00"), checkInLocation: saboli }),
      call({ id: "b", checkInAt: clock("10:30"), checkOutAt: clock("11:00"),
        checkInLocation: { latitude: 0, longitude: 0 } })
    ]);

    expect(built.visits[1].distanceKm).toBeUndefined();
    expect(built.travelledKm).toBe(0);
  });

  it("does not measure a distance to a clinic nobody has been to yet", () => {
    /*
     * A pending stop has a registered coordinate, so a distance *could* be
     * computed — but it would be a journey that has not happened, sitting in a
     * column of ones that have. "How far is the next one" is the plan's question.
     */
    const built = round([
      call({ id: "done", checkInAt: clock("09:30"), checkOutAt: clock("10:00"), checkInLocation: saboli }),
      call({ id: "todo", status: "Planned", plannedStart: "14:00",
        doctor: { id: "d-todo", name: "Doctor todo", location: dwarka } })
    ]);
    expect(built.visits[1].distanceKm).toBeUndefined();
  });

  it("does not let a pending stop become the origin of the next leg", () => {
    // The rep skipped the middle clinic entirely; the journey is from the first
    // to the third, not from a place they never reached.
    const built = round([
      call({ id: "first", checkInAt: clock("09:30"), checkOutAt: clock("10:00"), checkInLocation: saboli }),
      call({ id: "skipped", status: "Planned", plannedStart: "11:00",
        doctor: { id: "d-skip", name: "Doctor skip", location: dwarka } }),
      call({ id: "third", checkInAt: clock("12:00"), checkOutAt: clock("12:30"), checkInLocation: gokalpur })
    ]);

    const third = built.visits.find(visit => visit.id === "third")!;
    expect(third.distanceKm).toBeCloseTo(2.2, 0);
    expect(third.distanceFrom).toBe("checked-in");
  });

  it("totals the day, and says when any of it came from an address", () => {
    const built = round([
      call({ id: "a", checkInAt: clock("09:30"), checkOutAt: clock("10:00"), checkInLocation: saboli }),
      call({ id: "b", checkInAt: clock("10:40"), checkOutAt: clock("11:10"), checkInLocation: gokalpur }),
      call({ id: "c", checkInAt: clock("12:00"), checkOutAt: clock("12:30"),
        doctor: { id: "d-c", name: "Doctor c", location: dwarka } })
    ]);

    expect(built.travelledKm).toBeCloseTo(
      (built.visits[1].distanceKm ?? 0) + (built.visits[2].distanceKm ?? 0), 5);
    expect(built.travelledApproximate).toBe(true);
  });

  it("reports nothing rather than zero when no call carried a position", () => {
    const built = round([
      call({ id: "a", checkInAt: clock("09:30"), checkOutAt: clock("10:00") }),
      call({ id: "b", checkInAt: clock("11:00"), checkOutAt: clock("11:30") })
    ]);
    expect(built.travelledKm).toBe(0);
    expect(built.travelledApproximate).toBe(false);
    expect(built.visits[1].distanceKm).toBeUndefined();
  });
});

describe("what the day came to", () => {
  it("counts done, missed and still to go", () => {
    const built = round([
      call({ id: "a", checkInAt: clock("09:30"), checkOutAt: clock("10:00") }),
      call({ id: "b", status: "Missed", outcome: "Clinic closed", checkInAt: clock("10:30"), checkOutAt: clock("10:35") }),
      call({ id: "c", status: "Planned", plannedStart: "14:00" })
    ]);

    expect(built.completed).toBe(1);
    expect(built.missed).toBe(1);
    expect(built.pending).toBe(1);
    expect(built.total).toBe(3);
  });

  it("judges completion on what was attempted, not on the whole day", () => {
    // Three calls into a round of nine is three of three attempted. Judging a
    // rep at lunchtime against a day they have not finished is how a live
    // screen becomes one nobody trusts.
    const built = round([
      call({ id: "a", checkInAt: clock("09:30"), checkOutAt: clock("10:00") }),
      call({ id: "b", checkInAt: clock("10:30"), checkOutAt: clock("11:00") }),
      call({ id: "c", checkInAt: clock("11:30"), checkOutAt: clock("12:00") }),
      ...["d", "e", "f"].map(id => call({ id, status: "Planned", plannedStart: "15:00" }))
    ]);
    expect(built.completionRate).toBe(100);
  });

  it("totals the samples and the orders", () => {
    const built = round([
      call({ id: "a", checkInAt: clock("09:30"), checkOutAt: clock("10:00"), orderValue: 4200,
        samples: [{ product: "Glow Serum", quantity: 3 }, { product: "Cleanser", quantity: 2 }] }),
      call({ id: "b", checkInAt: clock("11:00"), checkOutAt: clock("11:30"), orderValue: 1800,
        samples: [{ product: "Glow Serum", quantity: 4 }] })
    ]);

    expect(built.sampleUnits).toBe(9);
    expect(built.orderValue).toBe(6000);
    // Heaviest first, so the product a rep is actually pushing is at the top.
    expect(built.samplesByProduct).toEqual([
      { product: "Glow Serum", quantity: 7 },
      { product: "Cleanser", quantity: 2 }
    ]);
  });

  it("marks a call the rep made on their own account", () => {
    const built = round([
      call({ id: "planned", checkInAt: clock("09:30"), checkOutAt: clock("10:00") }),
      call({ id: "extra", routePlan: null, checkInAt: clock("11:00"), checkOutAt: clock("11:20") })
    ]);
    expect(built.visits[0].unplanned).toBe(false);
    expect(built.visits[1].unplanned).toBe(true);
  });
});

describe("tallySamples", () => {
  it("ignores a blank product and a nonsense quantity", () => {
    expect(tallySamples([
      call({ id: "a", samples: [{ product: "", quantity: 5 }, { product: "Serum", quantity: -3 }] }),
      call({ id: "b", samples: [{ product: "Serum", quantity: 2 }] })
    ])).toEqual([{ product: "Serum", quantity: 2 }]);
  });
});

describe("describeState", () => {
  const started = round([
    call({ id: "a", checkInAt: clock("09:30"), checkOutAt: clock("10:00") }),
    call({ id: "b", status: "Planned", plannedStart: "14:00" })
  ]);
  const finished = round([call({ id: "a", checkInAt: clock("09:30"), checkOutAt: clock("10:00") })]);
  const idle = round([call({ id: "a", status: "Planned", plannedStart: "09:30" })]);

  it("reads an unfinished day differently today than in the past", () => {
    /*
     * One fact, two sentences. Still being out at four is the ordinary state of
     * a working afternoon; still being out last Tuesday is a round nobody
     * finished, and somebody should be asked about it rather than have it
     * scroll past looking normal.
     */
    expect(describeState(started, true)).toEqual({ label: "In progress · 1 to go", tone: "info" });
    expect(describeState(started, false)).toEqual({ label: "Left unfinished · 1 not visited", tone: "warn" });
  });

  it("reads a day nobody began the same way", () => {
    expect(describeState(idle, true).tone).toBe("neutral");
    expect(describeState(idle, false)).toEqual({ label: "Never started", tone: "warn" });
  });

  it("says so when the round is done, whenever it is read", () => {
    for (const isToday of [true, false]) {
      expect(describeState(finished, isToday)).toEqual({ label: "Round complete", tone: "success" });
    }
  });
});

describe("byProgress", () => {
  it("puts the busiest day first and anybody who never set off last", () => {
    const busy = { completed: 6, total: 8, employeeName: "Asha" } as never;
    const quiet = { completed: 1, total: 8, employeeName: "Vikram" } as never;
    const idle = { completed: 0, total: 5, employeeName: "Neha" } as never;
    expect([quiet, idle, busy].sort(byProgress).map((round: { employeeName: string }) => round.employeeName))
      .toEqual(["Asha", "Vikram", "Neha"]);
  });

  it("falls back to the name so the order never shuffles between loads", () => {
    const first = { completed: 2, total: 4, employeeName: "Asha" } as never;
    const second = { completed: 2, total: 4, employeeName: "Bhavna" } as never;
    expect([second, first].sort(byProgress).map((round: { employeeName: string }) => round.employeeName))
      .toEqual(["Asha", "Bhavna"]);
  });
});
