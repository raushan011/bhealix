import { describe, expect, it } from "vitest";
import { windowStart } from "./sync";

const NOW = new Date("2026-08-12T10:55:00").getTime();
const LAST_SYNC = new Date("2026-08-12T09:49:00");

describe("windowStart", () => {
  it("honours an explicit start, whatever the last run says", () => {
    /*
     * The regression this file exists for.
     *
     * "Full resync" sends a 90-day window precisely because the incremental one
     * is finding nothing. Preferring `lastSyncAt` here — or dropping the
     * argument on the way, which is how it actually happened — turns the repair
     * button into the thing it was meant to repair, and it reports "0 orders
     * read" while looking like a broken integration.
     */
    const explicit = new Date("2026-05-14T10:55:00");
    expect(windowStart(explicit, LAST_SYNC, 90, NOW)).toEqual(explicit);
  });

  it("continues from the last run, with an hour of overlap", () => {
    // The overlap covers an order Shopify indexes a moment after it writes it;
    // without it, a skipped order is a rep unpaid with nothing to explain why.
    const start = windowStart(undefined, LAST_SYNC, 90, NOW);
    expect(start).toEqual(new Date("2026-08-12T08:49:00"));
  });

  it("reaches back over the backfill window when nothing has ever been pulled", () => {
    const start = windowStart(undefined, undefined, 90, NOW);
    expect(Math.round((NOW - start.getTime()) / 86_400_000)).toBe(90);
  });
});
