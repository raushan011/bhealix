/**
 * Removes named codes from the coupon catalogue.
 *
 * The catalogue is a record of what *exists*, not who owns what — ownership is
 * on `SalesRep.coupons` and is never touched here. Orders keep their own
 * `couponCode` too, so deleting a row changes no attribution and no commission;
 * it only takes the code off the Coupons screen.
 *
 * It comes back. Every sync calls `refreshFromShopify()`, which upserts the
 * shop's whole discount list, and `noteCodesSeen()` re-adds any code found on an
 * order. A code that still exists in Shopify will reappear on the next pass.
 * To be rid of one for good, delete it in Shopify first, then run this.
 *
 * Refuses to delete a code a rep holds — that would leave the rep's coupon
 * pointing at nothing, and the screen re-adds it as an orphan on the next read
 * anyway. Unassign it in the UI first if you really mean to.
 *
 * Lists what it would do and changes nothing unless --apply is passed:
 *
 *   node scripts/delete-coupons.mjs
 *   node scripts/delete-coupons.mjs --apply
 */
import fs from "node:fs";
import mongoose from "mongoose";

/**
 * A discount in Shopify has a single left-to-right mark (U+200E) for a code,
 * which renders as nothing at all — an empty row on the Coupons screen. Built
 * from its code point rather than written literally, so that an editor or a
 * copy-paste cannot silently strip it and leave the row undeletable.
 */
const INVISIBLE = String.fromCodePoint(0x200e);

/** The unassigned, expired codes cluttering the Coupons screen. */
const CODES = [
  INVISIBLE,
  "317N2RS1JZYK",
  "50OFF",
  "ADVANCE100",
  "BUY3FOR999",
  "BUY999",
  "OFFER20",
  "OFFER40",
  "SAVE5",
  "SOFTLAUNCH20",
  "SOFTLAUNCH30-OLD",
  "WELCOME10",
  "WELCOME5"
];

function readEnv(key) {
  for (const file of [".env.local", ".env"]) {
    if (!fs.existsSync(file)) continue;
    const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find(row => row.startsWith(`${key}=`));
    if (line) return line.slice(key.length + 1).trim();
  }
  return process.env[key];
}

const uri = readEnv("MONGODB_URI");
if (!uri) throw new Error("MONGODB_URI is not set in .env.local");

const apply = process.argv.includes("--apply");
const wanted = [...new Set(CODES.map(code => code.trim().toUpperCase()))];

await mongoose.connect(uri);
const db = mongoose.connection;
console.log(`Connected to ${db.name}\n`);

const coupons = db.collection("salescoupons");
const reps = db.collection("salesreps");
const orders = db.collection("salesorders");

const present = await coupons.find({ code: { $in: wanted } }).toArray();
const byCode = new Map(present.map(entry => [entry.code, entry]));

// Whose is what, so a held code is never quietly removed from under a rep.
const held = new Map();
for (const rep of await reps.find({ "coupons.code": { $in: wanted } }, { projection: { name: 1, coupons: 1 } }).toArray()) {
  for (const coupon of rep.coupons ?? []) {
    const code = String(coupon?.code ?? "").trim().toUpperCase();
    if (wanted.includes(code)) held.set(code, rep.name ?? "(unnamed rep)");
  }
}

const attributed = new Map(
  (await orders.aggregate([
    { $match: { couponCode: { $in: wanted } } },
    { $group: { _id: "$couponCode", orders: { $sum: 1 } } }
  ]).toArray()).map(row => [row._id, row.orders])
);

/** A code printed as nothing is a line nobody can check, so name it instead. */
const show = code => code === INVISIBLE ? "(invisible U+200E)" : code;

const doomed = [];
for (const code of wanted) {
  const entry = byCode.get(code);
  const owner = held.get(code);
  const used = attributed.get(code) ?? 0;

  if (!entry) { console.log(`  skip    ${show(code)} — not in the catalogue`); continue; }
  if (owner) { console.log(`  KEPT    ${show(code)} — held by ${owner}; unassign it first`); continue; }

  const note = [entry.status ?? "Unknown", `from ${entry.discoveredFrom ?? "Order"}`, used ? `${used} attributed order(s)` : null]
    .filter(Boolean).join(", ");
  console.log(`  delete  ${show(code)} — ${note}`);
  doomed.push(code);
}

console.log("");
if (!doomed.length) {
  console.log("Nothing to delete.");
} else if (!apply) {
  console.log(`${doomed.length} row(s) would be deleted. Re-run with --apply to do it.`);
} else {
  const { deletedCount } = await coupons.deleteMany({ code: { $in: doomed } });
  console.log(`Deleted ${deletedCount} row(s). They return on the next sync unless they are gone from Shopify too.`);
}

await mongoose.disconnect();
