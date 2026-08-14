import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesRep } from "@/models/Sales";
import { apiPartner } from "@/lib/auth/partner";
import { badRequest, fail, ok } from "@/lib/api";
import { recordByRep } from "@/lib/audit";
import { PAYOUT_MODES } from "@/lib/sales/constants";
import { passwordProblem, PASSWORD_MIN } from "@/lib/sales/partners";

/**
 * The details a rep maintains about themselves: where the money should go, and
 * their password.
 *
 * Where it goes is theirs to set — nobody else knows their UPI id, and an
 * administrator retyping it from a WhatsApp message is how money reaches the
 * wrong account. Requiring approval before they may change it (`mustTrade`) is
 * the counterweight: a bank field is the one thing on this form worth attacking.
 *
 * What they cannot change from here is as important. Not their rep code, which
 * is the front half of coupons already printed on somebody's counter. Not their
 * `status` or `active` flag, which are the company's decisions about them. Not
 * their name, which is what a payout advice is made out to. Those are all
 * absent from the schema rather than filtered afterwards, so an extra field in
 * the request body is discarded by zod before any of this code sees it.
 */

const schema = z.object({
  phone: z.string().trim().min(6).max(20).optional(),
  payMethod: z.enum(PAYOUT_MODES).optional(),
  upiId: z.string().trim().max(80).optional().or(z.literal("")),
  bankName: z.string().trim().max(80).optional().or(z.literal("")),
  bankAccountName: z.string().trim().max(80).optional().or(z.literal("")),
  bankAccountNo: z.string().trim().max(32).optional().or(z.literal("")),
  bankIfsc: z.string().trim().max(16).optional().or(z.literal("")),
  panNumber: z.string().trim().max(12).optional().or(z.literal("")),

  /**
   * Changing the password, which needs the current one.
   *
   * A session cookie is not sufficient authority to replace the credential that
   * issued it: an unattended phone would otherwise be a permanent takeover
   * rather than a session somebody can end.
   */
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().max(200).optional()
});

/**
 * The payment details, read back for the form to fill in.
 *
 * Deliberately not part of `/api/partner/me`. That route feeds the home screen,
 * which every rep loads on every visit; a bank account number has no business
 * travelling with it. It is fetched here, by the one screen that edits it.
 */
export async function GET() {
  try {
    const auth = await apiPartner();
    if ("response" in auth) return auth.response;
    await connectDb();

    const rep = await SalesRep.findById(auth.rep._id)
      .select("phone payMethod upiId bankName bankAccountName bankAccountNo bankIfsc panNumber")
      .lean() as Record<string, unknown> | null;

    if (!rep) return badRequest("Please sign in again", 401);

    const { _id, ...details } = rep;
    void _id;
    return ok(details);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await apiPartner({ mustTrade: true });
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = schema.parse(await request.json());
    const rep = await SalesRep.findById(auth.rep._id).select("+passwordHash");
    if (!rep) return badRequest("Please sign in again", 401);

    const changed: string[] = [];

    if (input.newPassword !== undefined) {
      const problem = passwordProblem(input.newPassword);
      if (problem) return badRequest(problem);
      if (!input.currentPassword) return badRequest("Enter your current password to change it.");
      if (!rep.passwordHash || !(await bcrypt.compare(input.currentPassword, rep.passwordHash))) {
        return badRequest("That is not your current password.");
      }
      rep.passwordHash = await bcrypt.hash(input.newPassword, 12);
      changed.push("password");
    } else if (input.currentPassword !== undefined) {
      return badRequest(`Enter a new password of at least ${PASSWORD_MIN} characters.`);
    }

    for (const field of ["phone", "payMethod", "upiId", "bankName", "bankAccountName", "bankAccountNo", "bankIfsc", "panNumber"] as const) {
      const value = input[field];
      if (value === undefined) continue;
      // An emptied box clears the field rather than storing "", so a rep who
      // switches from a bank transfer to UPI does not leave a stale account
      // number behind for a payout advice to print.
      rep.set(field, value === "" ? undefined : value);
      changed.push(field);
    }

    if (!changed.length) return badRequest("Nothing to change.");

    await rep.save();

    /*
     * Two lines rather than one, because a changed password and a changed bank
     * account are different questions later. The bank fields are named but never
     * valued — an audit trail holding somebody's account number is a copy of the
     * thing it was written to protect.
     */
    if (changed.includes("password")) {
      await recordByRep({
        rep: String(rep._id), action: "sales.rep.password.changed",
        entityType: "SalesRep", entityId: String(rep._id), metadata: { code: rep.code }
      });
    }

    const details = changed.filter(field => field !== "password");
    if (details.length) {
      await recordByRep({
        rep: String(rep._id), action: "sales.rep.profile.updated",
        entityType: "SalesRep", entityId: String(rep._id), metadata: { code: rep.code, fields: details }
      });
    }

    return ok({ changed });
  } catch (error) {
    return fail(error);
  }
}
