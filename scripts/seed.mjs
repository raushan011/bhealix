/**
 * Prepares the database for the BHEALIX CRM.
 *
 * Safe to run repeatedly and safe to run against real data: it never deletes
 * doctors. It creates the demo accounts and product catalogue, then migrates
 * any call timings held in the old `mrcallschedules` collection into the
 * `callSchedule` field the app now reads.
 */
import fs from "node:fs";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

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

await mongoose.connect(uri);
const db = mongoose.connection;
console.log(`Connected to ${db.name}`);

// ---------------------------------------------------------------- accounts
const password = process.env.SEED_PASSWORD ?? "Bhealix@123";
const passwordHash = await bcrypt.hash(password, 12);

const accounts = [
  { employeeId: "BHX-ADMIN", name: "Ananya Mehta", email: "admin@bhealix.test", role: "ADMIN" },
  { employeeId: "BHX-HR01", name: "Neha Singh", email: "hr@bhealix.test", role: "HR" },
  { employeeId: "BHX-MR01", name: "Rohan Shah", email: "mr@bhealix.test", role: "MR" },
  { employeeId: "BHX-MR02", name: "Nisha Jain", email: "mr2@bhealix.test", role: "MR" },
  { employeeId: "BHX-SL01", name: "Vikram Rao", email: "sales@bhealix.test", role: "SALES" }
];

for (const account of accounts) {
  await db.collection("users").updateOne(
    { email: account.email },
    {
      $set: { ...account, active: true, updatedAt: new Date() },
      // Only set the password when the account is first created, so a real
      // password chosen later is never silently reset by re-seeding.
      $setOnInsert: { passwordHash, createdAt: new Date() }
    },
    { upsert: true }
  );
}
console.log(`${accounts.length} accounts ready`);

// ---------------------------------------------------------------- products
const products = [
  { name: "BHEALIX Gentle Face Wash", category: "Cleanser" },
  { name: "BHEALIX Vitamin C Serum", category: "Serum" },
  { name: "BHEALIX Hydrating Moisturiser", category: "Moisturiser" },
  { name: "BHEALIX Mineral Sunscreen SPF 50", category: "Sun care" },
  { name: "BHEALIX Acne Control Gel", category: "Treatment" },
  { name: "BHEALIX Anti-Pigmentation Cream", category: "Treatment" },
  { name: "BHEALIX Hair Fall Tonic", category: "Hair care" }
];

for (const product of products) {
  await db.collection("products").updateOne(
    { name: product.name },
    { $set: { ...product, sampleAvailable: true, active: true, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
}
console.log(`${products.length} products ready`);

// ------------------------------------------------- migrate old call timings
const collections = await db.db.listCollections({ name: "mrcallschedules" }).toArray();
if (collections.length) {
  const legacy = await db.collection("mrcallschedules").find().toArray();
  const byDoctor = new Map();

  for (const row of legacy) {
    if (!row.doctor || !Array.isArray(row.slots) || !row.slots.length) continue;
    const key = String(row.doctor);
    const windows = byDoctor.get(key) ?? [];
    windows.push({
      weekday: row.weekday,
      slots: row.slots.filter(slot => slot?.start && slot?.end).map(slot => ({ start: slot.start, end: slot.end })),
      appointmentRequired: Boolean(row.appointmentRequired),
      remarks: row.instructions ?? "",
      updatedAt: row.updatedAt ?? new Date()
    });
    byDoctor.set(key, windows);
  }

  let migrated = 0;
  for (const [doctorId, windows] of byDoctor) {
    const usable = windows.filter(window => window.slots.length);
    if (!usable.length) continue;
    const result = await db.collection("doctors").updateOne(
      { _id: new mongoose.Types.ObjectId(doctorId), $or: [{ callSchedule: { $exists: false } }, { callSchedule: { $size: 0 } }] },
      { $set: { callSchedule: usable, callTimeVerifiedAt: new Date() } }
    );
    migrated += result.modifiedCount;
  }
  console.log(`Migrated call timings for ${migrated} doctor(s) from the old collection`);
} else {
  console.log("No legacy call-time collection found — nothing to migrate");
}

// --------------------------------------------------- normalise doctor state
// Older records used lead stages that no longer exist. Map them to the closest
// current meaning rather than discarding what was already known about a lead.
const validStages = ["New", "Contacted", "Interested", "Prescribing", "Not interested"];
const stageMap = { Visited: "Contacted", Assigned: "New", Unverified: "New", Converted: "Prescribing" };

let stageFixCount = 0;
for (const [oldStage, newStage] of Object.entries(stageMap)) {
  const result = await db.collection("doctors").updateMany({ stage: oldStage }, { $set: { stage: newStage } });
  stageFixCount += result.modifiedCount;
}
// Anything still unrecognised falls back to the start of the funnel.
const remaining = await db.collection("doctors").updateMany(
  { stage: { $nin: validStages } },
  { $set: { stage: "New" } }
);
stageFixCount += remaining.modifiedCount;
const statusFix = await db.collection("doctors").updateMany(
  { status: { $nin: ["Active", "Archived"] } },
  { $set: { status: "Active" } }
);
const scheduleFix = await db.collection("doctors").updateMany(
  { callSchedule: { $exists: false } },
  { $set: { callSchedule: [] } }
);
console.log(`Normalised ${stageFixCount} stages, ${statusFix.modifiedCount} statuses, ${scheduleFix.modifiedCount} schedules`);

const totals = {
  doctors: await db.collection("doctors").countDocuments(),
  withCallTime: await db.collection("doctors").countDocuments({ "callSchedule.0": { $exists: true } }),
  withLocation: await db.collection("doctors").countDocuments({ "location.coordinates": { $exists: true, $ne: null } })
};

console.log("\nReady.");
console.log(`  Doctors: ${totals.doctors} (${totals.withCallTime} with call time, ${totals.withLocation} with coordinates)`);
console.log(`  Sign in: admin@bhealix.test / ${password}`);
console.log("  Change these credentials before going live.\n");

await mongoose.disconnect();
