import { describe, expect, it } from "vitest";
import { completePoint } from "./location";

describe("a doctor's place on the map", () => {
  it("keeps a whole point, longitude first", () => {
    expect(completePoint({ type: "Point", coordinates: [77.3, 28.7] }))
      .toEqual({ type: "Point", coordinates: [77.3, 28.7] });
  });

  /**
   * The one that broke adding a doctor by hand: a schema default put
   * `{ type: "Point" }` on every new record, and the 2dsphere index refuses
   * half a point at insert time — so the whole save failed with a message
   * about geo keys, and the screen could only say something went wrong.
   */
  it("throws away a point with nothing in it, rather than letting the save fail", () => {
    expect(completePoint({ type: "Point" })).toBeUndefined();
    expect(completePoint({ type: "Point", coordinates: [] })).toBeUndefined();
    expect(completePoint({ coordinates: [77.3] })).toBeUndefined();
    expect(completePoint(undefined)).toBeUndefined();
    expect(completePoint(null)).toBeUndefined();
  });

  it("refuses a coordinate that is not a number", () => {
    expect(completePoint({ coordinates: ["77.3", "28.7"] })).toBeUndefined();
    expect(completePoint({ coordinates: [77.3, Number.NaN] })).toBeUndefined();
    expect(completePoint({ coordinates: [null, 28.7] })).toBeUndefined();
  });

  /** A latitude past the pole is refused by MongoDB as firmly as a missing one. */
  it("refuses a coordinate off the globe, and catches the pair typed the wrong way round", () => {
    expect(completePoint({ coordinates: [77.3, 128.7] })).toBeUndefined();
    expect(completePoint({ coordinates: [200, 28.7] })).toBeUndefined();
    // 28.7, 77.3 — latitude first, as somebody reading it off a map would say
    // it. Both are within range, so it saves; it simply lands in China.
    expect(completePoint({ coordinates: [28.7, 77.3] })).toBeDefined();
  });

  it("does not carry anything else the caller attached", () => {
    expect(completePoint({ type: "Polygon", coordinates: [77.3, 28.7], accuracy: 12 }))
      .toEqual({ type: "Point", coordinates: [77.3, 28.7] });
  });
});
