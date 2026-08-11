/**
 * Builds the multipart body the photo endpoint actually expects.
 *
 * Getting this wrong is quietly expensive: the handler rejects a form with no
 * `photo` field, and separately rejects one with no location, both with a 400.
 * A test that posts under the wrong field name therefore still sees the 400 it
 * asserted and passes — while never having exercised the type or size check it
 * was written for.
 */

/** A one-pixel PNG. Genuine bytes, so the decoder has something real to read. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * @param files  `[filename, contentType, contents]` triples.
 * @param fix    Overrides for the location, which the handler requires.
 */
export function photoForm(files, fix = {}) {
  const form = new FormData();

  for (const [filename, contentType, contents] of files) {
    const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    form.append("photo", new Blob([bytes], { type: contentType }), filename);
  }

  const location = { latitude: 19.076, longitude: 72.8777, accuracy: 12, ...fix };
  for (const [key, value] of Object.entries(location)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  form.append("caption", "integration test");

  return form;
}
