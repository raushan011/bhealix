/**
 * Builds the sample ledger from visits that were completed before stock was
 * tracked.
 *
 * Safe to run repeatedly: each visit's rows are keyed on the visit, so a second
 * run replaces them rather than doubling the count. It only ever writes
 * DISPENSE rows — what a rep was *issued* before this feature existed is not
 * recorded anywhere, so the script cannot invent it.
 *
 * Pass --opening to also write one ADJUSTMENT per rep and product, sized so
 * every balance starts at zero instead of deeply negative. Do that only if you
 * do not intend to enter the historical issues by hand.
 *
 *   node scripts/backfill-sample-ledger.mjs
 *   node scripts/backfill-sample-ledger.mjs --opening
 */
import fs from "node:fs";
import mongoose from "mongoose";

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

const withOpening = process.argv.includes("--opening");

await mongoose.connect(uri);
const db = mongoose.connection;
console.log(`Connected to ${db.name}`);

const visits = db.collection("visits");
const products = db.collection("products");
const movements = db.collection("samplemovements");

const idByName = new Map(
  (await products.find({}, { projection: { name: 1 } }).toArray()).map(product => [product.name, product._id])
);

// ------------------------------------------------------------- hand-overs
const completed = await visits.find(
  { status: "Completed", "samples.0": { $exists: true } },
  { projection: { employee: 1, doctor: 1, samples: 1, checkOutAt: 1, plannedDate: 1 } }
).toArray();

let written = 0, skipped = 0;
const now = new Date();

for (const visit of completed) {
  const rows = (visit.samples ?? [])
    .filter(sample => sample?.product && Number(sample.quantity) > 0)
    .map(sample => ({
      employee: visit.employee,
      product: idByName.get(sample.product),
      productName: sample.product,
      type: "DISPENSE",
      quantity: -Math.abs(Math.trunc(sample.quantity)),
      doctor: visit.doctor,
      visit: visit._id,
      actor: visit.employee,
      occurredAt: visit.checkOutAt ?? visit.plannedDate ?? now,
      createdAt: now,
      updatedAt: now
    }));

  // Replace, never append — this is what makes a second run harmless.
  await movements.deleteMany({ visit: visit._id, type: "DISPENSE" });
  if (!rows.length) { skipped++; continue; }
  await movements.insertMany(rows);
  written += rows.length;
}

console.log(`Hand-overs: ${written} row(s) from ${completed.length} completed visit(s), ${skipped} with nothing to record.`);

// --------------------------------------------------------- opening balance
if (withOpening) {
  await movements.deleteMany({ type: "ADJUSTMENT", notes: "Opening balance (backfill)" });

  const shortfalls = await movements.aggregate([
    { $group: { _id: { employee: "$employee", product: "$productName" }, balance: { $sum: "$quantity" } } },
    { $match: { balance: { $lt: 0 } } }
  ]).toArray();

  if (shortfalls.length) {
    await movements.insertMany(shortfalls.map(row => ({
      employee: row._id.employee,
      product: idByName.get(row._id.product),
      productName: row._id.product,
      type: "ADJUSTMENT",
      quantity: -row.balance,
      occurredAt: now,
      notes: "Opening balance (backfill)",
      createdAt: now,
      updatedAt: now
    })));
  }
  console.log(`Opening balances: ${shortfalls.length} adjustment(s) so no rep starts below zero.`);
} else {
  console.log("Balances will read negative until you record the stock these reps were issued. Re-run with --opening to zero them instead.");
}

await mongoose.disconnect();
console.log("Done.");
