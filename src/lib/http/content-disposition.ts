/**
 * The `Content-Disposition` header for a file being served back.
 *
 * There is a trap in this header that only shows up once a file is named after
 * something a person typed. HTTP header values are ByteStrings — one byte per
 * character — and Node throws outright rather than mangling anything when asked
 * to send one containing a character above 255. So a download named
 * `Razorpay — August.pdf`, or an invoice a rep saved with a rupee sign in the
 * name, does not come back with a slightly wrong file name: the whole request
 * fails with a 500 and no clue as to why.
 *
 * RFC 6266 has the answer and it is to send the name twice. `filename=` carries
 * an ASCII version for anything ancient, and `filename*=` carries the real one
 * percent-encoded as UTF-8, which every browser released this century prefers.
 */

/** Quotes and backslashes end the quoted string early; control characters are not names. */
const asciiFallback = (name: string) => {
  const stripped = name
    .replace(/[^\x20-\x7e]/g, "-")
    .replace(/["\\]/g, "-")
    .replace(/-{2,}/g, "-")
    .trim();
  /*
   * A name written entirely in another script — `भुगतान.pdf` — survives that as
   * `-.pdf`, which is worse than useless: it is truthy, so it would be sent as
   * the fallback, and a browser too old for `filename*` would save a file called
   * "-". Anything with no letters or digits left in it is not a name.
   */
  return /[a-z0-9]/i.test(stripped) ? stripped : "download";
};

/**
 * `attachment` saves the file; `inline` lets the browser display it. The same
 * bytes either way — the only difference is what the browser is told to do.
 */
export function contentDisposition(name: string, mode: "attachment" | "inline" = "attachment"): string {
  const fallback = asciiFallback(name);
  const encoded = encodeURIComponent(name);

  // The star form is only worth sending when it says something different.
  return encoded === fallback
    ? `${mode}; filename="${fallback}"`
    : `${mode}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
