/** Reads the ids the global setup seeded. */
import fs from "node:fs";
import path from "node:path";

const file = path.join(import.meta.dirname, "..", ".fixtures.json");

export function fixtures() {
  if (!fs.existsSync(file)) {
    throw new Error("No fixtures. Run through `npm run test:api` so the global setup seeds first.");
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** An id that is well-formed but belongs to nothing — for 404-versus-400 checks. */
export const MISSING_ID = "0123456789abcdef01234567";
