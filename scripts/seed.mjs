import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
const uri = fs
  .readFileSync(".env.local", "utf8")
  .split(/\r?\n/)
  .find((x) => x.startsWith("MONGODB_URI="))
  ?.slice(12);
if (!uri) throw new Error("MONGODB_URI missing");
await mongoose.connect(uri);
const db = mongoose.connection;
const hash = await bcrypt.hash("Bhealix@123", 12);
const accounts = [
  {
    employeeId: "BHL-ADMIN",
    name: "Ananya Mehta",
    email: "admin@bhealix.test",
    role: "ADMIN",
  },
  {
    employeeId: "BHL-MR01",
    name: "Rohan Shah",
    email: "mr@bhealix.test",
    role: "MR",
  },
  {
    employeeId: "BHL-MR02",
    name: "Nisha Jain",
    email: "mr2@bhealix.test",
    role: "MR",
  },
  {
    employeeId: "BHL-HR01",
    name: "Neha Singh",
    email: "hr@bhealix.test",
    role: "HR",
  },
  {
    employeeId: "BHL-SALES01",
    name: "Vikram Rao",
    email: "sales@bhealix.test",
    role: "SALES",
  },
];
for (const account of accounts)
  await db
    .collection("users")
    .updateOne(
      { email: account.email },
      {
        $set: {
          ...account,
          passwordHash: hash,
          permissions: [],
          active: true,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
const users = await db
  .collection("users")
  .find({ email: { $in: accounts.map((x) => x.email) } })
  .toArray();
const mr = users.find((x) => x.role === "MR"),
  sales = users.find((x) => x.role === "SALES");
const names = [
  "Mira Iyer",
  "Arun Khanna",
  "Saloni Das",
  "Isha Kapoor",
  "Ritu Sharma",
  "Aman Verma",
  "Nisha Jain",
  "Karan Patel",
  "Divya Menon",
  "Sameer Rao",
];
for (let i = 0; i < 30; i++)
  await db
    .collection("doctors")
    .updateOne(
      { code: `BHD-${String(i + 1).padStart(5, "0")}` },
      {
        $set: {
          name: `Dr. ${names[i % names.length]}`,
          specialties: [i % 3 === 0 ? "Dermatology" : "General Medicine"],
          doctorTypes: [i % 3 === 0 ? "Dermatologist" : "General physician"],
          clinicName: `${["Glow Skin", "Care Point", "Aster", "Derma Plus"][i % 4]} Clinic`,
          phones: [`+9190000${String(i).padStart(5, "0")}`],
          city: ["Bengaluru", "Mumbai", "Delhi", "Pune"][i % 4],
          area: ["Indiranagar", "Andheri", "Saket", "Koregaon Park"][i % 4],
          priority: ["Hot", "High", "Medium", "Low"][i % 4],
          stage: ["New", "Assigned", "Visited", "Interested"][i % 4],
          status: "Active",
          dataSource: "Seed",
          treatsSkinProblems: i % 3 === 0,
          assignedTo: i % 2 === 0 ? mr?._id : sales?._id,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          code: `BHD-${String(i + 1).padStart(5, "0")}`,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
for (const name of ["Noida", "Delhi NCR", "Ghaziabad"])
  await db
    .collection("territories")
    .updateOne(
      { name },
      {
        $set: { cities: [name], active: true, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
for (const [i, category] of [
  "Face wash",
  "Face serum",
  "Toner",
  "Moisturizer",
  "Sunscreen",
].entries())
  await db
    .collection("products")
    .updateOne(
      { sku: `BHL-${i + 1}` },
      {
        $set: {
          name: `BHEALIX ${category}`,
          category,
          active: true,
          sampleAvailable: true,
          price: 299 + i * 100,
          updatedAt: new Date(),
        },
        $setOnInsert: { sku: `BHL-${i + 1}`, createdAt: new Date() },
      },
      { upsert: true },
    );
const doctors = await db.collection("doctors").find().limit(6).toArray();
for (const [i, doctor] of doctors.entries()) {
  await db
    .collection("mrcallschedules")
    .updateOne(
      { doctor: doctor._id, clinic: null, weekday: (i + 1) % 7 },
      {
        $set: {
          allowed: true,
          slots: [{ start: "14:00", end: "16:00" }],
          appointmentRequired: i % 2 === 0,
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  if (mr)
    await db
      .collection("assignments")
      .updateOne(
        {
          doctor: doctor._id,
          employee: mr._id,
          date: new Date(new Date().setHours(0, 0, 0, 0)),
        },
        {
          $set: {
            scheduledTime: `${10 + i}:00`,
            status: "Scheduled",
            recurrence: "None",
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
}
console.log("Seed complete: admin@bhealix.test / Bhealix@123");
await mongoose.disconnect();
