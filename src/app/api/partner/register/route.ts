import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesRep } from "@/models/Sales";
import { createPartnerToken, setPartnerCookie } from "@/lib/auth/partner";
import { badRequest, fail, ok } from "@/lib/api";
import { recordByRep } from "@/lib/audit";
import { normaliseCode } from "@/lib/sales/coupons";
import { passwordProblem, PASSWORD_MIN, repCodeProblem } from "@/lib/sales/partners";
import { callerKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * Somebody applying to sell on commission.
 *
 * The only route in the affiliate CRM a stranger can reach, and the shape of it
 * is decided by one fact: **registering grants nothing.** The record is created
 * as `Pending`, no coupon is issued, no order can be attributed and no money can
 * be earned until an administrator has looked at it and said yes.
 *
 * That is what makes the form safe to leave open. A coupon code is an
 * instruction to pay a named person a share of every order carrying it — if
 * filling in a form produced one, the first bot to find this URL would be on the
 * payroll. Approval is not an afterthought bolted on for tidiness; it is the
 * whole reason self-registration can exist at all.
 *
 * They are signed in immediately on success, deliberately. Somebody who has just
 * filled in a form wants to see that it arrived, and the portal tells them they
 * are waiting far more clearly than an email nobody sent.
 */

const schema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  /**
   * Optional, because it is not what identifies them.
   *
   * Sign-in takes the email *or* the rep code, and the code is the one they
   * will still know six months from now — it is printed on their coupons and
   * read down the telephone. Plenty of the people this form is for reach the
   * company on WhatsApp and have no address they check, and refusing them at
   * the first field for the sake of a column nothing reads was the wrong trade.
   * An empty string arrives from the form when it is left blank, and is folded
   * to nothing rather than stored — see below on why that matters.
   */
  email: z.email("Enter a valid email address").optional().or(z.literal("")),
  phone: z.string().trim().min(6, "Enter a phone number we can reach you on").max(20),
  /** The front half of every coupon they will hold, so they choose it themselves. */
  code: z.string().trim().min(2).max(24),
  password: z.string().min(PASSWORD_MIN).max(200)
});

export async function POST(request: Request) {
  try {
    // Five applications from one address in an hour is already generous for a
    // form a person fills in once. See `lib/rate-limit.ts` for what this does
    // and does not promise.
    const limit = rateLimit(callerKey(request, "partner-register"), 5, 60 * 60 * 1000);
    if (!limit.ok) return tooManyRequests(limit.retryAfter, "Too many applications from here. Please try again later.");

    await connectDb();
    const input = schema.parse(await request.json());

    const code = normaliseCode(input.code);
    const codeProblem = repCodeProblem(code);
    if (codeProblem) return badRequest(codeProblem);

    const passwordFault = passwordProblem(input.password);
    if (passwordFault) return badRequest(passwordFault);

    /*
     * Blank becomes absent, never an empty string.
     *
     * The email index is unique and sparse, and a sparse index only skips
     * documents where the field is *missing*. Storing "" would put every
     * address-less applicant on the same key, so the second one to apply would
     * be refused for clashing with the first — and refused, of all things, over
     * a field neither of them filled in.
     */
    const email = input.email?.toLowerCase().trim() || undefined;

    /*
     * Both clashes are reported plainly, and by name.
     *
     * The usual reason to be vague about which accounts exist does not apply
     * here: a rep code is printed on coupons and read out on the telephone, so
     * it was never a secret, and somebody whose chosen code is taken has to be
     * told that in order to choose another. Concealing it would trade nothing
     * for a form that refuses without saying why.
     *
     * The email clause is spread in rather than always present. `{ email:
     * undefined }` is not a query for "nobody" — it matches every document
     * without the field, so the first address-less partner would make the form
     * refuse everyone after them.
     */
    const clash = await SalesRep.findOne({
      $or: [{ code }, ...(email ? [{ email }] : [])]
    }).select("code email").lean() as { code?: string; email?: string } | null;
    if (clash) {
      return badRequest(email && clash.email === email
        ? "There is already an account with that email address. Sign in instead, or use a different address."
        : `The code ${code} is already taken. Try adding an initial — ${code}S, for instance.`, 409);
    }

    const rep = await SalesRep.create({
      name: input.name,
      code,
      email,
      phone: input.phone,
      passwordHash: await bcrypt.hash(input.password, 12),
      status: "Pending",
      selfRegistered: true,
      // Their codes would attribute orders the moment they had one; the status
      // is what stops them having one. Left true so approving is a single
      // change rather than two that can be half-done.
      active: true,
      coupons: [],
      joinedAt: new Date(),
      lastLoginAt: new Date()
    });

    await recordByRep({
      rep: String(rep._id),
      action: "sales.rep.registered",
      entityType: "SalesRep",
      entityId: String(rep._id),
      metadata: { code, email, name: input.name }
    });

    await setPartnerCookie(await createPartnerToken({ repId: String(rep._id), name: rep.name, code }));

    return ok({ name: rep.name, code, status: "Pending", redirectTo: "/partner" }, 201);
  } catch (error) {
    return fail(error);
  }
}
