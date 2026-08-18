/**
 * Moves the affiliate books from weekly payout runs to paying per order.
 *
 * Commissions used to sit in `Maturing` for seven days after delivery and in
 * `In payout` once a run had claimed them. Neither state exists any more: a
 * delivered order is `Payable` at once, and it is paid one at a time from the
 * Payouts screen. Any order still stored under the old states is moved to
 * `Payable` here — which is exactly what both of them meant: delivered, owed,
 * not yet paid — and the fields the run left on it are removed.
 *
 * Orders a run had already marked `Paid` are left as they are: the money went,
 * and the payment record is written onto the order from the run so the partner
 * still sees when and how. The run documents themselves are then dropped.
 *
 * The nightly re-pricing would fix the statuses on its own by the morning; this
 * exists so the screens are right the moment the change is deployed. Safe to
 * run twice.
 *
 * Lists what it would do and changes nothing unless --apply is passed:
 *
 *   node scripts/retire-payout-runs.mjs
 *   node scripts/retire-payout-runs.mjs --apply
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

const apply = process.argv.includes("--apply");

await mongoose.connect(uri);
const db = mongoose.connection;
console.log(`Connected to ${db.name}\n`);

const orders = db.collection("salesorders");
const runs = db.collection("salespayouts");
const lines = db.collection("salespayoutlines");

const stale = await orders.countDocuments({ "commission.status": { $in: ["Maturing", "In payout"] } });
const paidByRun = await orders.find({ "commission.status": "Paid", "commission.payout": { $ne: null }, "commission.payment": { $exists: false } })
  .project({ name: 1, "commission.payout": 1 }).toArray();
const runCount = await runs.countDocuments({});
const lineCount = await lines.countDocuments({});

console.log(`  ${stale} order(s) stored as Maturing / In payout → Payable`);
console.log(`  ${paidByRun.length} order(s) paid by a run → payment written onto the order`);
console.log(`  ${runCount} payout run(s) and ${lineCount} line(s) → dropped`);
console.log("");

if (!apply) {
  console.log("Nothing changed. Re-run with --apply to do it.");
} else {
  const moved = await orders.updateMany(
    { "commission.status": { $in: ["Maturing", "In payout"] } },
    { $set: { "commission.status": "Payable" }, $unset: { "commission.maturesAt": "", "commission.payout": "" } }
  );
  console.log(`Moved ${moved.modifiedCount} order(s) to Payable.`);

  let written = 0;
  for (const order of paidByRun) {
    const run = await runs.findOne({ _id: order.commission.payout });
    await orders.updateOne({ _id: order._id }, {
      $set: {
        "commission.payment": {
          paidAt: run?.paidAt ?? new Date(),
          paidBy: run?.paidBy,
          paymentDate: run?.paymentDate,
          mode: run?.paymentMode,
          reference: run?.reference,
          note: run?.payoutNo ? `Paid on run ${run.payoutNo}` : undefined
        }
      },
      $unset: { "commission.maturesAt": "", "commission.payout": "" }
    });
    written++;
  }
  console.log(`Wrote the payment onto ${written} paid order(s).`);

  const cleared = await orders.updateMany(
    { $or: [{ "commission.maturesAt": { $exists: true } }, { "commission.payout": { $exists: true } }] },
    { $unset: { "commission.maturesAt": "", "commission.payout": "" } }
  );
  console.log(`Cleared run fields from ${cleared.modifiedCount} other order(s).`);

  if (runCount || lineCount) {
    if (runCount) await runs.drop();
    if (lineCount) await lines.drop();
    console.log("Dropped the payout run collections.");
  }
}

await mongoose.disconnect();
