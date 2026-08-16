/**
 * Puts the test database into a known state.
 *
 * Writes through the raw driver rather than the Mongoose models, for the same
 * reason scripts/seed.mjs does: the models import through the `@/` alias, which
 * only Next's compiler resolves, so a plain node script cannot load them.
 *
 * Safe to run repeatedly. Everything it creates is marked, and `reset()` removes
 * exactly what is marked — a run cannot delete a record it did not create, even
 * if somebody points it at a database that has real data in it.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { TEST_DB_URI, TEST_PASSWORD, ACCOUNTS, TEST_MARKER } from "./config.mjs";

let connection;

export async function connect() {
  if (connection) return connection;
  await mongoose.connect(TEST_DB_URI);
  connection = mongoose.connection;
  return connection;
}

export async function disconnect() {
  if (connection) await mongoose.disconnect();
  connection = undefined;
}

/** Collections the suite writes to, in an order that is safe to delete in. */
const COLLECTIONS = [
  "vendorinvoices", "financeperiods",
  "visitphotos", "visits", "paymentproofs", "invoices", "routeplans",
  "samplemovements", "samplestocks", "inventorymovements", "stockitems",
  "attendances", "leaverequests", "payrollruns", "payslips",
  "auditevents", "doctors", "products", "users"
];

/**
 * Removes only what these tests created.
 *
 * Keyed on the marker rather than on a collection drop: a dropped collection
 * takes its indexes with it, and the unique index on `users.email` is load
 * bearing — a suite that ran after a drop would let duplicate accounts through
 * and the test asserting a 409 would fail for a reason nothing to do with the
 * code under test.
 */
export async function reset() {
  const db = (await connect()).db;
  const existing = new Set((await db.listCollections().toArray()).map(c => c.name));
  for (const name of COLLECTIONS) {
    if (!existing.has(name)) continue;
    await db.collection(name).deleteMany({ [TEST_MARKER]: true });
  }
}

/**
 * Creates the accounts, doctors and products the suite reads.
 *
 * Returns the ids, because a test that needs "a doctor belonging to another
 * rep" should be handed one rather than have to go and find it.
 */
export async function seed({ doctors = 25, products = 5 } = {}) {
  const db = (await connect()).db;
  await reset();

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  const users = {};

  for (const [key, account] of Object.entries(ACCOUNTS)) {
    const doc = {
      ...account,
      passwordHash,
      active: true,
      joiningDate: "2024-01-01",
      employmentType: "Full time",
      employmentStatus: "Confirmed",
      [TEST_MARKER]: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection("users").updateOne(
      { email: account.email },
      { $set: doc },
      { upsert: true }
    );
    const stored = await db.collection("users").findOne({ email: account.email }, { projection: { _id: 1 } });
    users[key] = String(stored._id);
  }

  // Doctors, half assigned to each field account, so ownership filtering has
  // something to actually filter.
  const doctorDocs = Array.from({ length: doctors }, (_, i) => ({
    code: `TESTDOC-${String(i + 1).padStart(4, "0")}`,
    name: `Test Doctor ${i + 1}`,
    specialties: [["Cardiology", "Dermatology", "Paediatrics"][i % 3]],
    clinicName: `Test Clinic ${i + 1}`,
    phones: [`90000${String(i).padStart(5, "0")}`],
    area: `Area ${i % 5}`,
    city: ["Mumbai", "Pune", "Nagpur"][i % 3],
    state: "Maharashtra",
    stateCode: "27",
    pinCode: `4000${String(i % 100).padStart(2, "0")}`,
    // A real 2dsphere-indexable point, scattered around Mumbai.
    location: { type: "Point", coordinates: [72.87 + (i % 10) * 0.01, 19.07 + (i % 10) * 0.01] },
    source: "Manual",
    priority: ["Hot", "High", "Medium", "Low"][i % 4],
    stage: "New",
    status: "Active",
    assignedTo: new mongoose.Types.ObjectId(i % 2 === 0 ? users.MR : users.MR2),
    [TEST_MARKER]: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }));
  await db.collection("doctors").insertMany(doctorDocs);

  const productDocs = Array.from({ length: products }, (_, i) => ({
    name: `Test Product ${i + 1}`,
    category: "Test",
    sampleAvailable: true,
    active: true,
    hsnCode: "3004",
    unit: "Pcs",
    price: 100 + i * 50,
    mrp: 150 + i * 50,
    gstRate: [5, 12, 18][i % 3],
    reorderLevel: 10,
    [TEST_MARKER]: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }));
  await db.collection("products").insertMany(productDocs);

  const storedDoctors = await db.collection("doctors")
    .find({ [TEST_MARKER]: true }, { projection: { _id: 1, assignedTo: 1 } }).toArray();
  const storedProducts = await db.collection("products")
    .find({ [TEST_MARKER]: true }, { projection: { _id: 1 } }).toArray();

  return {
    users,
    doctorIds: storedDoctors.map(d => String(d._id)),
    /** Split by owner, so an IDOR test can pick one that is definitely not yours. */
    doctorsOfMr: storedDoctors.filter(d => String(d.assignedTo) === users.MR).map(d => String(d._id)),
    doctorsOfMr2: storedDoctors.filter(d => String(d.assignedTo) === users.MR2).map(d => String(d._id)),
    productIds: storedProducts.map(p => String(p._id))
  };
}

// Allow `node tests/support/seed.mjs` to prepare the database on its own.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { assertSafeTarget } = await import("./config.mjs");
  assertSafeTarget();
  const result = await seed();

  // The ids file is what the load harness and any ad-hoc script read. Writing
  // it here too means `npm run test:seed` leaves the same state the vitest
  // global setup would, rather than a database that no longer matches the
  // fixtures on disk.
  const fs = await import("node:fs");
  const path = await import("node:path");
  fs.writeFileSync(
    path.join(import.meta.dirname, "..", ".fixtures.json"),
    JSON.stringify(result, null, 2)
  );

  console.log(`Seeded ${result.doctorIds.length} doctors, ${result.productIds.length} products, ${Object.keys(result.users).length} users`);
  console.log(`Database: ${TEST_DB_URI.replace(/\/\/[^@]+@/, "//***@")}`);
  await disconnect();
}
