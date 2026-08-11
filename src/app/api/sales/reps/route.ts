import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesRep } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { isRepCode, normaliseCode, REP_CODE_SHAPE } from "@/lib/sales/coupons";
import { PAYOUT_MODES } from "@/lib/sales/constants";
import { repSummaries } from "@/lib/sales/reporting";

const couponSchema = z.object({
  code: z.string().trim().min(3).max(32),
  suffix: z.string().trim().regex(/^\d{1,3}$/, "A coupon's suffix is the digits at the end of the code"),
  active: z.boolean().default(true),
  note: z.string().trim().max(120).optional()
});

const repSchema = z.object({
  name: z.string().trim().min(2, "Enter the rep's name"),
  code: z.string().trim().regex(REP_CODE_SHAPE, "A rep code is letters and digits with no spaces, like RAUSHAN"),
  phone: z.string().trim().max(20).optional(),
  email: z.email("Enter a valid email").optional().or(z.literal("")),
  /** Omitted, the coupons are built from the rules in force. */
  coupons: z.array(couponSchema).max(12).optional(),
  payMethod: z.enum(PAYOUT_MODES).default("UPI"),
  upiId: z.string().trim().max(80).optional(),
  bankName: z.string().trim().max(80).optional(),
  bankAccountName: z.string().trim().max(80).optional(),
  bankAccountNo: z.string().trim().max(32).optional(),
  bankIfsc: z.string().trim().max(16).optional(),
  panNumber: z.string().trim().max(12).optional(),
  joinedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(500).optional(),
  active: z.boolean().default(true)
});

export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const activeOnly = params.get("active") === "1";
    const [reps, summaries] = await Promise.all([
      SalesRep.find(activeOnly ? { active: true } : {}).sort({ name: 1 }).lean(),
      repSummaries({}, { activeOnly })
    ]);

    return ok({ reps, summaries });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = repSchema.parse(await request.json());
    const code = normaliseCode(input.code);
    if (!isRepCode(code)) return badRequest("A rep code is letters and digits with no spaces, like RAUSHAN.");

    /*
     * Coupons are entered by hand, never invented.
     *
     * The CRM does not create discount codes — Shopify does — so guessing at
     * RAUSHAN10 and RAUSHAN30 only put codes here that might not exist over
     * there, and refused the ones that do: a rep may perfectly well be given a
     * code with no digits in it at all. Which rule applies is carried by the
     * coupon's `suffix`, chosen when it is added, rather than read out of the
     * letters.
     */
    const coupons = (input.coupons ?? []).map(coupon => ({ ...coupon, code: normaliseCode(coupon.code) }));

    const duplicate = coupons.find((coupon, at) => coupons.findIndex(other => other.code === coupon.code) !== at);
    if (duplicate) return badRequest(`"${duplicate.code}" is listed twice.`);

    const clash = await SalesRep.findOne({ $or: [{ code }, { "coupons.code": { $in: coupons.map(coupon => coupon.code) } }] })
      .select("code name coupons").lean() as { code?: string; name?: string } | null;
    if (clash) {
      return badRequest(`${clash.name} already holds that code. Two reps sharing a coupon would make every order it brings in unattributable.`, 409);
    }

    const rep = await SalesRep.create({
      ...input,
      code,
      email: input.email || undefined,
      coupons,
      createdBy: auth.session.userId
    });

    await record({
      actor: auth.session.userId,
      action: "sales.rep.created",
      entityType: "SalesRep",
      entityId: String(rep._id),
      metadata: { code, coupons: coupons.map(coupon => coupon.code) }
    });

    return ok({ _id: rep._id, code, coupons }, 201);
  } catch (error) {
    return fail(error);
  }
}
