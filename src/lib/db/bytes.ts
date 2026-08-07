/**
 * The bytes of a file held in MongoDB, whichever shape they arrive in.
 *
 * A `Buffer` field read through `.lean()` does not come back as a Buffer. Lean
 * skips Mongoose's casting entirely, and the driver hands back the raw BSON
 * `Binary` wrapper — an object whose `length` is a *method*, not a number.
 *
 * That combination fails quietly and in the worst possible way:
 * `new Uint8Array(binary)` sees no numeric `length`, produces an empty array,
 * and the route answers 200 with zero bytes and the right content type, so the
 * browser shows a broken image rather than an error anybody can act on. The
 * `if (!file?.data?.length)` guard above it passes too, because a function is
 * truthy. Every route that serves stored bytes goes through here instead.
 */
/*
 * The `Uint8Array<ArrayBuffer>` return, and the casts below, are for `Response`:
 * it will not take a view on the wider `ArrayBufferLike` in case it is shared
 * memory. Nothing here is — these bytes came off a socket into an ordinary
 * Node buffer — but only the narrower type says so.
 */
export function storedBytes(stored: unknown): Uint8Array<ArrayBuffer> {
  if (!stored) return EMPTY;

  // A hydrated document, or a driver configured to promote buffers: Buffer and
  // MongooseBuffer are both Uint8Arrays already.
  if (stored instanceof Uint8Array) return stored as Uint8Array<ArrayBuffer>;

  // BSON Binary: `buffer` holds the bytes and `position` how many of them are
  // real, the buffer having room to spare when one was built up in parts.
  const binary = stored as { buffer?: unknown; position?: unknown };
  if (binary.buffer instanceof Uint8Array) {
    const filled = typeof binary.position === "number" ? binary.position : binary.buffer.byteLength;
    return binary.buffer.subarray(0, Math.min(filled, binary.buffer.byteLength)) as Uint8Array<ArrayBuffer>;
  }

  return EMPTY;
}

const EMPTY: Uint8Array<ArrayBuffer> = new Uint8Array(0);
