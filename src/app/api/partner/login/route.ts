import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesRep } from "@/models/Sales";
import { createPartnerToken, setPartnerCookie } from "@/lib/auth/partner";
import { fail, ok } from "@/lib/api";
import { normaliseCode } from "@/lib/sales/coupons";
import { mayHoldSession, refusalFor, repStatusOf } from "@/lib/sales/partners";
import { callerKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * An affiliate signing in, by their email address or by their own rep code.
 *
 * Both work because both are things they actually know. The email is what they
 * registered with; the code is the word printed on their coupons, which is the
 * one they will remember six months later.
 */

const schema = z.object({ identifier: z.string().trim().min(2), password: z.string().min(1) });

export async function POST(request: Request) {
  try {
    // Ten attempts a minute leaves a fat-fingered password four or five goes and
    // makes guessing pointless.
    const limit = rateLimit(callerKey(request, "partner-login"), 10, 60 * 1000);
    if (!limit.ok) return tooManyRequests(limit.retryAfter, "Too many sign-in attempts. Please wait a minute and try again.");

    await connectDb();
    const input = schema.parse(await request.json());
    const identifier = input.identifier.trim();

    const rep = await SalesRep.findOne({
      $or: [{ email: identifier.toLowerCase() }, { code: normaliseCode(identifier) }]
    }).select("+passwordHash name code status active");

    /*
     * One message for three different failures — no such account, no password
     * set, wrong password — so the form cannot be used to find out which
     * affiliates exist.
     *
     * The middle case is real and easy to miss: every rep created before this
     * portal existed was typed in by an administrator and has no `passwordHash`
     * at all. `bcrypt.compare` against `undefined` throws rather than returning
     * false, so it is checked before it is called.
     */
    if (!rep?.passwordHash || !(await bcrypt.compare(input.password, rep.passwordHash))) {
      return Response.json({ error: "Incorrect email/code or password" }, { status: 401 });
    }

    /*
     * The standing is checked *after* the password, on purpose. Refusing a
     * suspended account before the password is verified would tell anybody who
     * typed a rep code — a public string — that the person exists and has been
     * suspended. Checking afterwards means only the account holder ever sees it,
     * which is also the only person the sentence is written for.
     */
    const status = repStatusOf(rep);
    if (!mayHoldSession(status)) {
      return Response.json({ error: refusalFor(status, rep.active !== false) ?? "This account is no longer active" }, { status: 403 });
    }

    rep.lastLoginAt = new Date();
    await rep.save();

    await setPartnerCookie(await createPartnerToken({ repId: String(rep._id), name: rep.name, code: rep.code }));

    return ok({ name: rep.name, code: rep.code, status, redirectTo: "/partner" });
  } catch (error) {
    return fail(error);
  }
}
