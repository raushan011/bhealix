/**
 * Creates a super administrator, or promotes an existing account to one.
 *
 *   node scripts/make-super-admin.mjs                       list the desk accounts
 *   node scripts/make-super-admin.mjs boss@bhealix.com      promote that account
 *   node scripts/make-super-admin.mjs boss@bhealix.com --create --name "Nikita" --password "…"
 *
 * Deliberately a script rather than a screen. The super administrator hands out
 * every other account's access, so a button anywhere in the application that
 * could create one would be a way for an administrator to promote themselves —
 * which is the exact thing the role exists to prevent. `ASSIGNABLE_ROLES` keeps
 * it off the Employees screen for the same reason. Shell access to the
 * deployment is the right bar for this, and this is the only way over it.
 *
 * Safe to run repeatedly. Promoting changes the role and nothing else: the name,
 * the password, the employment record and the history all stay exactly as they
 * were. To take it back, set the role to Administrator from Admin → Employees.
 */
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

/**
 * Reads one value out of the env files, the way Next.js reads them. Quotes are
 * stripped: `MONGODB_URI="mongodb+srv://…"` is valid in the file and fails with
 * an invalid-scheme error if the quotes reach the driver.
 *
 * **The environment wins over the files**, which is the opposite of what
 * `scripts/seed.mjs` next door does and is deliberate here. This script writes
 * the account that holds everybody's access, and on this repository `.env.local`
 * points at the live Atlas cluster — so a file that always won would mean there
 * was no way to run it against staging or a test database at all, and no way to
 * rehearse it. `MONGODB_URI=… node scripts/make-super-admin.mjs` now goes where
 * it is told. `tests/support/config.mjs` reads its configuration the same way.
 */
function readEnv(key) {
  if (process.env[key]) return process.env[key];
  for (const file of [".env.local", ".env"]) {
    if (!fs.existsSync(file)) continue;
    const line = fs.readFileSync(file, "utf8").split(/\r?\n/)
      .find(row => !row.trimStart().startsWith("#") && row.trimStart().startsWith(`${key}=`));
    if (line) return line.trimStart().slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return undefined;
}

/** `--name "Nikita"` and `--create`, without a dependency to parse two flags. */
function flag(name) {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return undefined;
  const next = process.argv[at + 1];
  return next && !next.startsWith("--") ? next : true;
}

const email = (process.argv[2] ?? "").trim().toLowerCase();
const uri = readEnv("MONGODB_URI");
if (!uri) throw new Error("MONGODB_URI is not set in .env.local");

// Named on the way in, with the credentials stripped. This writes the account
// that hands out everybody's access, and "which database did that go to" should
// never be a question anybody has to reconstruct afterwards.
console.log(`\nDatabase: ${uri.replace(/\/\/[^@]+@/, "//***@")}`);

await mongoose.connect(uri);
const users = mongoose.connection.collection("users");
const done = async (code = 0) => { await mongoose.disconnect(); process.exit(code); };

// ------------------------------------------------------- no email: list them
/*
 * Run with nothing, this says what accounts exist rather than a usage line.
 *
 * "No account with that email" is a dead end when you cannot remember which
 * address you signed up with, and looking it up means opening the CRM in a
 * browser — which is the thing you are trying to get into. Passwords are never
 * selected here; nothing but names, ids and roles is read.
 */
if (!email) {
  const rows = await users.find(
    { role: { $in: ["SUPERADMIN", "ADMIN", "HR"] } },
    { projection: { name: 1, email: 1, employeeId: 1, role: 1, active: 1 }, sort: { role: 1, name: 1 } }
  ).toArray();

  console.log("\nDesk accounts on this database:\n");
  if (!rows.length) {
    console.log("  (none — run `npm run seed` first, or pass --create below)\n");
  } else {
    for (const row of rows) {
      const marks = [row.role, row.active === false ? "inactive" : null].filter(Boolean).join(", ");
      console.log(`  ${String(row.email).padEnd(34)} ${String(row.name).padEnd(22)} ${marks}`);
    }
    console.log("");
  }

  console.log("Promote one:");
  console.log("  npm run super-admin -- boss@bhealix.com\n");
  console.log("Or create a separate account for it:");
  console.log('  npm run super-admin -- boss@bhealix.com --create --name "Your Name"\n');
  await done();
}

const account = await users.findOne({
  email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
});

// ------------------------------------------------------------ create one new
if (!account) {
  if (!flag("create")) {
    console.error(`\nNo account with the email ${email}.\n`);
    console.error("Create it as a separate super admin login:");
    console.error(`  npm run super-admin -- ${email} --create --name "Your Name"\n`);
    console.error("Or run with no arguments to see which accounts do exist.\n");
    await done(1);
  }

  const name = typeof flag("name") === "string" ? flag("name") : "Super Administrator";
  /*
   * A generated password when none is given, printed once and never stored in
   * anything but a bcrypt hash. Better than a default everybody knows, and
   * better than prompting — this script has to run in a CI shell and a pipe.
   */
  const password = typeof flag("password") === "string"
    ? flag("password")
    : randomBytes(9).toString("base64url");

  if (password.length < 8) {
    console.error("A password must be at least 8 characters.");
    await done(1);
  }

  /*
   * A unique employee id without asking for one. This account is frequently not
   * a person on the payroll — it is the credential that holds the books — but
   * the field is required and unique, so it is derived and checked rather than
   * assumed free.
   */
  let employeeId = "BHX-SUPER";
  for (let attempt = 2; await users.findOne({ employeeId }, { projection: { _id: 1 } }); attempt++) {
    employeeId = `BHX-SUPER-${attempt}`;
  }

  await users.insertOne({
    employeeId,
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: "SUPERADMIN",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  console.log(`\nCreated ${name} <${email}> as SUPERADMIN (${employeeId}).\n`);
  if (typeof flag("password") !== "string") {
    console.log(`  Password: ${password}`);
    console.log("  Shown once. Change it from the panel after signing in.\n");
  }
  console.log("  Sign in at /super-admin\n");
  await done();
}

// --------------------------------------------------------- promote an existing
if (account.role === "SUPERADMIN") {
  console.log(`\n${account.name} <${account.email}> is already a super administrator.`);
} else {
  /*
   * `workspaces` is cleared as well as the role being set.
   *
   * A super administrator holds every panel by role, so an array left over from
   * an earlier grant would be a decision that no longer applies but is still on
   * record — and if the account were ever demoted it would come back into force
   * silently. Removing it restores "nobody has decided", which is the honest
   * state for an account whose access is now a property of its role.
   */
  await users.updateOne(
    { _id: account._id },
    { $set: { role: "SUPERADMIN", active: true, updatedAt: new Date() }, $unset: { workspaces: "" } }
  );
  console.log(`\n${account.name} <${account.email}> was ${account.role} and is now SUPERADMIN.`);
}

console.log("\n  Sign in at /super-admin");
console.log("  If they are already signed in, they must sign out and back in — their");
console.log("  current session token still carries the old role.\n");
await done();
