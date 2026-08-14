import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesRep } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { passwordProblem } from "@/lib/sales/partners";

/**
 * Setting a partner's password, for the administrator on the telephone to
 * somebody locked out.
 *
 * **There is deliberately no way to read an existing password, here or
 * anywhere.** What is stored is a bcrypt hash — a one-way function — so there
 * is no plaintext held to show. That is not an oversight to be worked around
 * but the entire reason a stolen database is not a stolen set of accounts, and
 * it is the same choice `User.passwordHash` makes for staff next door. People
 * reuse passwords; a partner's password read off this screen is quite possibly
 * also their email password.
 *
 * So the answer to "what is their password" is to give them a new one. The
 * administrator sees it **once**, in the response to this request, reads it
 * down the phone, and it is never recoverable again — the same shape as the
 * staff reset on the HR profile screen.
 *
 * It doubles as the way a partner *gets* a login at all. Everybody entered by
 * hand before the portal existed has no `passwordHash`, and until now no way to
 * be given one: their sign-in attempts were refused as though the password were
 * wrong.
 */

const schema = z.object({
  /** Omitted, one is generated — which is the better habit and the usual path. */
  password: z.string().max(200).optional()
});

/**
 * Four short words.
 *
 * Readable down a bad phone line and typed on a phone keyboard without a
 * mistake, which a string like `xK7#pQ2!` is not — and long enough that it is
 * far harder to guess than the `Bhealix@123` somebody would otherwise choose.
 * `randomInt` rather than `Math.random`, because this is a credential.
 */
const WORDS = [
  "amber", "anchor", "basil", "beacon", "birch", "canvas", "cedar", "cobalt", "copper", "coral",
  "cotton", "crimson", "delta", "ember", "falcon", "fern", "garnet", "ginger", "granite", "harbour",
  "indigo", "ivory", "jasmine", "juniper", "lantern", "lemon", "linen", "maple", "marble", "meadow",
  "mint", "olive", "orchid", "otter", "pebble", "pepper", "pewter", "quartz", "raven", "ribbon",
  "saffron", "sage", "silver", "sparrow", "summit", "teal", "thistle", "topaz", "velvet", "willow"
];

const generate = () => Array.from({ length: 4 }, () => WORDS[randomInt(WORDS.length)]).join("-");

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid partner id");
    await connectDb();

    // An empty body is the ordinary case — "give them a new one" — so it is
    // read leniently rather than refused for want of a JSON object.
    const body = await request.json().catch(() => ({}));
    const input = schema.parse(body ?? {});

    const password = input.password?.trim() || generate();
    const problem = passwordProblem(password);
    if (problem) return badRequest(problem);

    const rep = await SalesRep.findById(id).select("+passwordHash name code status");
    if (!rep) return badRequest("No such partner", 404);

    const isFirst = !rep.passwordHash;
    rep.passwordHash = await bcrypt.hash(password, 12);
    await rep.save();

    await record({
      actor: auth.session.userId,
      // The password itself is of course never in the metadata — a trail holding
      // credentials is a copy of the thing it was written to protect.
      action: "sales.rep.password.reset",
      entityType: "SalesRep",
      entityId: String(rep._id),
      metadata: { code: rep.code, firstTime: isFirst }
    });

    return ok({
      /** Shown once and never again. Nothing stores it. */
      password,
      isFirst,
      message: isFirst
        ? `${rep.name} can now sign in at /partner/login with their email or the code ${rep.code}. Read them this password — it cannot be shown again.`
        : `${rep.name}'s password has been changed. Read them the new one — it cannot be shown again.`
    });
  } catch (error) {
    return fail(error);
  }
}
