import { describe, expect, it } from "vitest";
import { mongo } from "mongoose";
import { storedBytes } from "./bytes";

const { Binary } = mongo;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Compared as plain numbers: what matters is the bytes, not which view they arrive in. */
const bytesOf = (stored: unknown) => Array.from(storedBytes(stored));

describe("reading a file back out of MongoDB", () => {
  /**
   * The one that broke the payment QR: a `.lean()` read hands back a BSON
   * wrapper, `new Uint8Array(wrapper)` is empty, and the route answers 200 with
   * nothing in it — a broken image and no error anywhere to explain it.
   */
  it("unwraps the BSON Binary a lean read returns", () => {
    expect(bytesOf(new Binary(png))).toEqual(Array.from(png));
  });

  it("takes a Buffer from a hydrated document unchanged", () => {
    expect(bytesOf(png)).toEqual(Array.from(png));
  });

  /** A Binary can hold a buffer larger than the bytes written into it. */
  it("stops at the bytes that were written, not the room they sit in", () => {
    const roomy = new Binary(Buffer.alloc(64));
    roomy.buffer.set(png, 0);
    roomy.position = png.length;
    expect(storedBytes(roomy)).toHaveLength(png.length);
  });

  it("reports nothing rather than throwing when the field was never set", () => {
    expect(storedBytes(undefined)).toHaveLength(0);
    expect(storedBytes(null)).toHaveLength(0);
    expect(storedBytes({})).toHaveLength(0);
  });

  /**
   * The check the routes make before serving. `length` on a Binary is a method,
   * so the obvious `!value.length` is always false — the emptiness of the file
   * has to be decided after unwrapping, never before.
   */
  it("gives a length that can actually be tested for emptiness", () => {
    expect(storedBytes(new Binary(Buffer.alloc(0))).byteLength).toBe(0);
    expect(storedBytes(new Binary(png)).byteLength).toBe(png.length);
  });
});
