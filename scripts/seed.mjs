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

/**
 * Reads one value out of the env files, the way Next.js reads them.
 *
 * Quotes are stripped and commented lines are skipped: `MONGODB_URI="mongodb+srv://…"`
 * is perfectly valid and the app runs on it happily, but handing the quotes to
 * `mongoose.connect` fails with an invalid-scheme error that says nothing about
 * where the quotes came from.
 */
function readEnv(key) {
  for (const file of [".env.local", ".env"]) {
    if (!fs.existsSync(file)) continue;
    const line = fs.readFileSync(file, "utf8").split(/\r?\n/)
      .find(row => !row.trimStart().startsWith("#") && row.trimStart().startsWith(`${key}=`));
    if (line) return line.trimStart().slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
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

// Only the administrator is created by default. Real representatives are added
// from the Team screen; seeding fake staff would put them back after cleanup.
// Set SEED_DEMO_STAFF=1 if you want throwaway accounts for a demo.
const accounts = [
  { employeeId: "BHX-ADMIN", name: "BHEALIX Admin", email: "admin@bhealix.com", role: "ADMIN" }
];

if (process.env.SEED_DEMO_STAFF === "1") {
  accounts.push(
    { employeeId: "BHX-HR01", name: "Demo HR", email: "hr@bhealix.test", role: "HR" },
    { employeeId: "BHX-MR01", name: "Demo MR", email: "mr@bhealix.test", role: "MR" },
    { employeeId: "BHX-SL01", name: "Demo Sales", email: "sales@bhealix.test", role: "SALES" }
  );
}

for (const account of accounts) {
  await db.collection("users").updateOne(
    { email: account.email },
    {
      $set: { updatedAt: new Date() },
      /*
       * Everything about the account is set on creation only.
       *
       * Re-seeding used to reapply the name, the role and `active: true` every
       * run, so an administrator who had been renamed, moved to another role or
       * deactivated from the Team screen was silently put back — which is not
       * what "safe to run against real data" should mean.
       */
      $setOnInsert: { ...account, active: true, passwordHash, createdAt: new Date() }
    },
    { upsert: true }
  );
}
console.log(`${accounts.length} accounts ready`);

// ---------------------------------------------------------------- products
// Deliberately empty. Product names end up in sample-distribution reports, so
// inventing a range would put fabricated figures in front of the business.
// Add the real catalogue from Admin -> Products.
console.log(`Products in catalogue: ${await db.collection("products").countDocuments()} (add real ones from Admin → Products)`);

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
console.log(`  Sign in: admin@bhealix.com / ${password}`);
console.log("  Change these credentials before going live.\n");

await mongoose.disconnect();
