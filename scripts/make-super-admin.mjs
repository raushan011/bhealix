/**
 * Promotes one existing account to super administrator.
 *
 *   node scripts/make-super-admin.mjs admin@bhealix.com
 *
 * Deliberately a script rather than a screen, and deliberately not part of the
 * seed. The super administrator is the account that hands out every other
 * account's access; a button anywhere in the application that could create one
 * would be a way for an administrator to promote themselves, which is the exact
 * thing the role exists to prevent. Shell access to the deployment is the right
 * bar for it, and this is the only way over that bar.
 *
 * Safe to run repeatedly, and it changes nothing but the role: the name, the
 * password, the employment record and everything else stay exactly as they were,
 * so this is a promotion rather than a re-creation.
 *
 * To take it back, set the role to ADMIN from the Employees screen. There is no
 * demotion flag here on purpose — undoing it should be the ordinary, visible,
 * audited path, not a second script nobody remembers exists.
 */
import fs from "node:fs";
import mongoose from "mongoose";

/**
 * Reads one value out of the env files, the way Next.js reads them. Quotes are
 * stripped: `MONGODB_URI="mongodb+srv://…"` is valid in the file and fails with
 * an invalid-scheme error if the quotes are handed to the driver.
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

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/make-super-admin.mjs <email>");
  console.error("The account must already exist — create it from Admin → Employees first.");
  process.exit(1);
}

const uri = readEnv("MONGODB_URI");
if (!uri) throw new Error("MONGODB_URI is not set in .env.local");

await mongoose.connect(uri);
const users = mongoose.connection.collection("users");

const account = await users.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
if (!account) {
  console.error(`No account with the email ${email}.`);
  console.error("Create it from Admin → Employees, then run this again.");
  await mongoose.disconnect();
  process.exit(1);
}

if (account.role === "SUPERADMIN") {
  console.log(`${account.name} (${account.email}) is already a super administrator.`);
} else {
  /*
   * `workspaces` is cleared as well as the role being set.
   *
   * A super administrator holds every panel by role, so an array left over from
   * a previous grant would be a decision that no longer applies but is still
   * recorded — and if the account were ever demoted again it would come back
   * into force silently. Removing it restores "nobody has decided", which is
   * the honest state for an account whose access is now a property of its role.
   */
  await users.updateOne(
    { _id: account._id },
    { $set: { role: "SUPERADMIN", active: true, updatedAt: new Date() }, $unset: { workspaces: "" } }
  );
  console.log(`${account.name} (${account.email}) was ${account.role} and is now SUPERADMIN.`);
}

console.log("They will see the Super admin panel on the chooser after signing in again.");
await mongoose.disconnect();
