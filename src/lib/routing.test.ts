import { describe, expect, it } from "vitest";
import { haversineKm, planRoute, type RoutableDoctor } from "./routing";
import { toClock } from "./time";

const doctor = (id: string, latitude: number, longitude: number, slots: Array<[string, string]> = []): RoutableDoctor =>
  ({ id, name: id, latitude, longitude, slots: slots.map(([start, end]) => ({ start, end })) });

const options = { startTime: "09:00", visitMinutes: 45, speedKmh: 25 };
const order = (stops: Array<{ id: string }>) => stops.map(stop => stop.id);

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm({ latitude: 28.5, longitude: 77.3 }, { latitude: 28.5, longitude: 77.3 })).toBe(0);
  });
});

describe("planRoute", () => {
  it("falls back to nearest-first when no doctor has a confirmed call time", () => {
    const result = planRoute([
      doctor("a", 0, 0), doctor("b", 0, 1), doctor("c", 0, 0.1), doctor("d", 0, 0.5)
    ], "a", options);
    expect(order(result.stops)).toEqual(["a", "c", "d", "b"]);
    expect(result.unknownTimingCount).toBe(4);
  });

  it("puts call time ahead of distance: a far doctor open now beats a near one open later", () => {
    const result = planRoute([
      doctor("start", 28.50, 77.30),
      doctor("near-but-afternoon", 28.51, 77.31, [["14:00", "16:00"]]),
      doctor("far-but-morning", 28.70, 77.30, [["10:00", "12:00"]])
    ], "start", options);
    expect(order(result.stops)).toEqual(["start", "far-but-morning", "near-but-afternoon"]);
    expect(result.outsideCallTimeCount).toBe(0);
  });

  it("uses distance to break ties between doctors free at the same time", () => {
    const result = planRoute([
      doctor("start", 28.50, 77.30),
      doctor("far", 28.60, 77.40, [["10:00", "16:00"]]),
      doctor("near", 28.52, 77.32, [["10:00", "16:00"]])
    ], "start", options);
    expect(order(result.stops)).toEqual(["start", "near", "far"]);
  });

  it("waits for a window to open rather than showing an impossible arrival", () => {
    const result = planRoute([
      doctor("start", 28.50, 77.30),
      doctor("later", 28.52, 77.32, [["11:00", "16:00"]])
    ], "start", options);
    const stop = result.stops[1];
    expect(stop.waitMinutes).toBeGreaterThan(0);
    expect(toClock(stop.startMinutes)).toBe("11:00");
    expect(stop.withinCallTime).toBe(true);
  });

  it("flags doctors whose window has already closed instead of pretending they fit", () => {
    const result = planRoute([
      doctor("start", 28.50, 77.30),
      doctor("closed", 28.51, 77.31, [["07:00", "08:00"]]),
      doctor("open", 28.52, 77.32, [["10:00", "16:00"]])
    ], "start", options);
    expect(order(result.stops)).toEqual(["start", "open", "closed"]);
    expect(result.stops[2].withinCallTime).toBe(false);
    expect(result.outsideCallTimeCount).toBe(1);
  });

  it("reports totals a planner can act on", () => {
    const result = planRoute([
      doctor("a", 28.50, 77.30), doctor("b", 28.60, 77.40)
    ], "a", options);
    expect(result.totalDistanceKm).toBeGreaterThan(0);
    expect(result.totalTravelMinutes).toBeGreaterThan(0);
    expect(result.finishMinutes).toBeGreaterThan(9 * 60);
  });

  it("rejects a starting doctor that is not in the list", () => {
    expect(() => planRoute([doctor("a", 0, 0)], "missing", options)).toThrow();
  });
});
