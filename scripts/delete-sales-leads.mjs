/**
 * Empties the lead list the Sales CRM hands out to executives.
 *
 * Those leads live in `salesleads`, the same collection the Leads CRM finds and
 * saves them into — there is one list, shown on both screens — so deleting them
 * here empties both. Each lead's remarks and follow-ups are embedded in it and go
 * with it; the WhatsApp outreach messages and replies filed against a lead are
 * their own collections and are deleted alongside, so nothing is left pointing
 * at a lead that no longer exists.
 *
 * Orders are never touched. A sales order converted from a lead keeps its
 * customer, its money and its incentive; only its link back to the lead goes
 * dangling, which every screen already treats as "no lead".
 *
 * Everything that will be deleted is first written to `backups/` as JSON, so a
 * mistake can be put back with `mongoimport`.
 *
 * Lists what it would do and changes nothing unless --apply is passed:
 *
 *   node scripts/delete-sales-leads.mjs                   every lead
 *   node scripts/delete-sales-leads.mjs --assigned-only   only leads given to an executive
 *   node scripts/delete-sales-leads.mjs --apply           (either of the above, for real)
 */
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

function readEnv(key) {
  for (const file of [".env.local", ".env"]) {
    if (!fs.existsSync(file)) continue;
    const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find(row => row.startsWith(`${key}=`));
    if (line) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
  }
  return process.env[key];
}

const uri = readEnv("MONGODB_URI");
if (!uri) throw new Error("MONGODB_URI is not set in .env.local");

const apply = process.argv.includes("--apply");
const assignedOnly = process.argv.includes("--assigned-only");

await mongoose.connect(uri);
const db = mongoose.connection;
console.log(`Connected to ${db.name}\n`);

const leads = db.collection("salesleads");
const messages = db.collection("salesoutreachmessages");
const replies = db.collection("salesoutreachreplies");
const teamOrders = db.collection("salesteamorders");

const filter = assignedOnly ? { assignedTo: { $ne: null } } : {};
const ids = (await leads.find(filter, { projection: { _id: 1 } }).toArray()).map(row => row._id);
const linked = { lead: { $in: ids } };

const counts = {
  leads: ids.length,
  assigned: await leads.countDocuments({ ...filter, assignedTo: { $ne: null } }),
  messages: ids.length ? await messages.countDocuments(linked) : 0,
  replies: ids.length ? await replies.countDocuments(linked) : 0,
  orders: ids.length ? await teamOrders.countDocuments(linked) : 0
};

console.log(`  ${counts.leads} lead(s)${assignedOnly ? " assigned to an executive" : ""}, ${counts.assigned} of them assigned`);
console.log(`  ${counts.messages} outreach message(s) and ${counts.replies} repl(ies) filed against them`);
console.log(`  ${counts.orders} sales order(s) came from them — kept, untouched\n`);

if (!counts.leads) {
  console.log("Nothing to delete.");
} else if (!apply) {
  console.log("Nothing changed. Re-run with --apply to delete.");
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folder = path.join("backups", `sales-leads-${stamp}`);
  fs.mkdirSync(folder, { recursive: true });
  const dump = async (name, collection, query) => {
    const rows = await collection.find(query).toArray();
    fs.writeFileSync(path.join(folder, `${name}.json`), JSON.stringify(rows, null, 2));
    return rows.length;
  };
  await dump("salesleads", leads, { _id: { $in: ids } });
  await dump("salesoutreachmessages", messages, linked);
  await dump("salesoutreachreplies", replies, linked);
  console.log(`Backed up to ${folder}\n`);

  const gone = {
    replies: (await replies.deleteMany(linked)).deletedCount,
    messages: (await messages.deleteMany(linked)).deletedCount,
    leads: (await leads.deleteMany({ _id: { $in: ids } })).deletedCount
  };
  console.log(`Deleted ${gone.leads} lead(s), ${gone.messages} message(s), ${gone.replies} repl(ies).`);
}

await mongoose.disconnect();
