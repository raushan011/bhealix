import { describe, expect, it } from "vitest";
import { completeFix, formatAccuracy, formatFix, mapsPointUrl, stampLines } from "./geo";

describe("reading a fix off a phone", () => {
  it("keeps a whole fix and trims the digits that describe nothing", () => {
    expect(completeFix({ latitude: 12.9715987654, longitude: 77.5945627, accuracy: 8.4 }))
      .toEqual({ latitude: 12.971599, longitude: 77.594563, accuracy: 8 });
  });

  /**
   * A photo must never carry half a position. Half of one looks located on
   * every screen that shows it and points somewhere on the equator.
   */
  it("refuses half a fix, or one off the globe", () => {
    expect(completeFix({ latitude: 12.97 })).toBeUndefined();
    expect(completeFix({ longitude: 77.59 })).toBeUndefined();
    expect(completeFix({ latitude: 91, longitude: 77.59 })).toBeUndefined();
    expect(completeFix({ latitude: 12.97, longitude: 181 })).toBeUndefined();
    expect(completeFix({ latitude: "12.97", longitude: "77.59" })).toBeUndefined();
    expect(completeFix(null)).toBeUndefined();
  });

  /** A phone that reports no accuracy is still somewhere, and still saved. */
  it("keeps a fix whose accuracy is missing or nonsense", () => {
    expect(completeFix({ latitude: 12.97, longitude: 77.59 })).toEqual({ latitude: 12.97, longitude: 77.59 });
    expect(completeFix({ latitude: 12.97, longitude: 77.59, accuracy: -3 }))
      .toEqual({ latitude: 12.97, longitude: 77.59 });
  });
});

describe("writing a fix out", () => {
  it("names the hemisphere rather than leaning on a minus sign", () => {
    expect(formatFix({ latitude: 12.971599, longitude: 77.594563 })).toBe("12.971599° N, 77.594563° E");
    expect(formatFix({ latitude: -33.86882, longitude: -70.5 })).toBe("33.868820° S, 70.500000° W");
  });

  it("stops claiming metres once the phone is a kilometre out", () => {
    expect(formatAccuracy(8.4)).toBe("±8 m");
    expect(formatAccuracy(2400)).toBe("±2.4 km");
    expect(formatAccuracy(undefined)).toBe("");
  });

  it("points a maps link at the exact spot", () => {
    expect(mapsPointUrl({ latitude: 12.971599, longitude: 77.594563 }))
      .toBe("https://www.google.com/maps/search/?api=1&query=12.971599,77.594563");
  });
});

describe("the caption burnt into a photo", () => {
  const takenAt = new Date("2026-08-07T10:12:00.000Z");

  it("carries the address, both coordinates and the accuracy", () => {
    const lines = stampLines({
      fix: { latitude: 12.971599, longitude: 77.594563, accuracy: 8 },
      address: "MG Road, Bengaluru, Karnataka 560001",
      takenAt
    });
    expect(lines[0]).toBe("MG Road, Bengaluru, Karnataka 560001");
    expect(lines[1]).toBe("Lat 12.971599° N   Long 77.594563° E");
    expect(lines[2]).toContain("±8 m");
    expect(lines[2]).toContain("2026");
  });

  /** Google not answering must not cost the coordinates, which are the proof. */
  it("still stamps the coordinates when no address came back", () => {
    const lines = stampLines({ fix: { latitude: 12.971599, longitude: 77.594563 }, takenAt });
    expect(lines[0]).toBe("Address unavailable");
    expect(lines[1]).toContain("12.971599° N");
  });

  it("says so plainly when there was no fix at all", () => {
    expect(stampLines({ takenAt })[0]).toBe("Location unavailable");
  });
});
