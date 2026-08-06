import { afterEach, describe, expect, it, vi } from "vitest";
import { daysLeft, photoExpiryFrom, PHOTO_RETENTION_DAYS } from "./visits";

afterEach(() => vi.useRealTimers());

describe("visit photo retention", () => {
  it("dates a photo thirty days out from when it was taken", () => {
    const taken = new Date("2026-08-07T10:30:00.000Z");
    const expires = photoExpiryFrom(taken);
    expect(expires.toISOString()).toBe("2026-09-06T10:30:00.000Z");
    expect((expires.getTime() - taken.getTime()) / 86_400_000).toBe(PHOTO_RETENTION_DAYS);
  });

  it("counts the whole days a rep has left before a photo goes", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-08-07T10:00:00.000Z"));
    expect(daysLeft(photoExpiryFrom(new Date("2026-08-07T10:00:00.000Z")))).toBe(30);
    expect(daysLeft(new Date("2026-08-08T10:00:00.000Z"))).toBe(1);
  });

  /**
   * The TTL sweep runs about once a minute, so a photo can sit a short while
   * past its date before MongoDB removes it. Nothing should ever report that as
   * time remaining — the reading queries exclude it, and the screen must agree.
   */
  it("never reports time left on a photo that has already expired", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-08-07T10:00:00.000Z"));
    expect(daysLeft(new Date("2026-08-07T09:59:00.000Z"))).toBe(0);
    expect(daysLeft(new Date("2026-06-01T00:00:00.000Z"))).toBe(0);
  });
});
