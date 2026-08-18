import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { encodeSecret, PARTNER_AUDIENCE as AUDIENCE, PARTNER_COOKIE as COOKIE, sessionCookieOptions, signSessionToken, verifySession } from "./token";
import { mayHoldSession, mayTrade, refusalFor, repStatusOf, type RepStatus } from "@/lib/sales/partners";

/**
 * The affiliate's session, kept deliberately apart from the staff one.
 *
 * Two cookies and two audiences rather than one cookie with a role on it, and
 * the separation is the point. An affiliate is an outsider: they are not on the
 * payroll, they did not sign a contract of employment, and they must never
 * reach `/admin` or `/employee` however the role checks downstream are written.
 *
 * With a shared cookie, that guarantee rests on every guard in the application
 * remembering to exclude one role — a promise renewed on every future screen and
 * broken the first time somebody forgets. With two, the staff guard never reads
 * the affiliate's cookie at all, so there is no check to forget. Belt and
 * braces: the token also carries `aud: "partner"`, which the staff verifier
 * refuses outright, so pasting one cookie's value into the other's name achieves
 * nothing either.
 *
 * The staff side was left alone on purpose — existing tokens carry no audience
 * and adding a required one would have signed every employee out on deploy. It
 * rejects the partner audience instead, which is the same guarantee without the
 * flag day.
 */

export const PARTNER_COOKIE = COOKIE;
export const PARTNER_AUDIENCE = AUDIENCE;

/*
 * A fortnight idle and ninety days at the outside, against the staff panel's
 * three and thirty — see `lib/auth/token.ts` for the two clocks.
 *
 * Longer because the audience is different: a beautician checking on a Sunday
 * whether last week's orders have cleared, on their own phone, is not the same
 * risk as a finance desk with the payroll open. It costs nothing in authority,
 * because nothing here is trusted on the token's word — every request reloads
 * the rep and re-reads their standing, so a suspension takes effect on the next
 * tap rather than whenever the token happens to run out.
 */

export type PartnerSession = {
  repId: string;
  name: string;
  /** Their rep code — the front half of every coupon they hold. */
  code: string;
};

/** The fields any partner route needs off the rep, loaded fresh on every request. */
export type PartnerRep = {
  _id: unknown;
  name?: string;
  code?: string;
  email?: string;
  phone?: string;
  status?: string;
  active?: boolean;
  reviewNote?: string;
  coupons?: { code?: string; suffix?: string; active?: boolean; setup?: string; setupError?: string; issuedBy?: string; issuedAt?: Date }[];
};

const secret = () => {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not configured");
  return encodeSecret(value);
};

export async function createPartnerToken(session: PartnerSession) {
  return signSessionToken("partner", { repId: session.repId, name: session.name, code: session.code }, secret());
}

/** Writes the cookie. One place, so the flags cannot drift between login, registration and refresh. */
export async function setPartnerCookie(token: string) {
  (await cookies()).set(PARTNER_COOKIE, token, sessionCookieOptions("partner", process.env.NODE_ENV === "production"));
}

export async function clearPartnerCookie() {
  (await cookies()).set(PARTNER_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Whoever the cookie says this is, or null. Says nothing about whether they may still act. */
export async function getPartnerSession(): Promise<PartnerSession | null> {
  const token = (await cookies()).get(PARTNER_COOKIE)?.value;
  if (!token || !process.env.AUTH_SECRET) return null;
  const verified = await verifySession("partner", token, secret());
  if (!verified?.payload.repId) return null;
  const { payload } = verified;
  return {
    repId: String(payload.repId),
    name: typeof payload.name === "string" ? payload.name : "",
    code: typeof payload.code === "string" ? payload.code : ""
  };
}

/**
 * Loads the rep behind the cookie, refusing anybody who may no longer be here.
 *
 * The reload is not a formality. A token lasts a week and carries a name; the
 * decision to suspend somebody is taken in the admin panel and has to bite
 * immediately, not whenever their session next expires. So the standing is read
 * from the database on every single request, and the token is treated as an
 * identity claim and nothing more.
 */
export async function loadPartner(session: PartnerSession): Promise<PartnerRep | null> {
  const { connectDb } = await import("@/lib/db/mongoose");
  const { SalesRep } = await import("@/models/Sales");
  await connectDb();
  return await SalesRep.findById(session.repId)
    .select("name code email phone status active reviewNote coupons payMethod upiId bankName bankAccountName bankAccountNo bankIfsc panNumber joinedAt createdAt")
    .lean() as PartnerRep | null;
}

/**
 * For pages under /partner: guarantees a signed-in affiliate who is still
 * allowed in.
 *
 * It deliberately does **not** clear the cookie on the way out, though that is
 * the obvious thing to want here. A layout is a Server Component, and Next
 * refuses a cookie write during render — so clearing it would throw instead of
 * redirecting, and a suspended rep would meet a crash rather than an
 * explanation.
 *
 * The cookie is cleared by the login screen instead, which arrives with
 * `?ended=1` and calls the logout route. Until it does, the token is still
 * technically valid, and that is fine: it opens nothing. Middleware only checks
 * the signature, and every page and route behind it re-reads the rep's standing
 * from the database — which is what turned them away in the first place.
 */
export async function requirePartner(): Promise<{ session: PartnerSession; rep: PartnerRep; status: RepStatus }> {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const rep = await loadPartner(session);
  const status = repStatusOf(rep);
  if (!rep || !mayHoldSession(status)) redirect("/partner/login?ended=1");

  return { session, rep, status };
}

/**
 * For partner API routes. Mirrors `apiSession` next door, and returns the live
 * rep alongside the session so no route has to remember to load it.
 *
 * `mustTrade` is the gate on everything that touches money or attribution:
 * minting a coupon, changing where a payout is sent. A rep waiting to be
 * approved passes the first check and fails this one, which is exactly the
 * distinction the portal is built around — they can come in and see where they
 * stand, and do nothing else.
 */
export async function apiPartner(options: { mustTrade?: boolean } = {}):
  Promise<{ session: PartnerSession; rep: PartnerRep } | { response: Response }> {
  const session = await getPartnerSession();
  if (!session) return { response: Response.json({ error: "Please sign in again" }, { status: 401 }) };

  const rep = await loadPartner(session);
  if (!rep) return { response: Response.json({ error: "Please sign in again" }, { status: 401 }) };

  const status = repStatusOf(rep);
  if (!mayHoldSession(status)) {
    return { response: Response.json({ error: refusalFor(status, rep.active !== false) ?? "This account is no longer active" }, { status: 403 }) };
  }

  if (options.mustTrade && !mayTrade(rep)) {
    return { response: Response.json({ error: refusalFor(status, rep.active !== false) ?? "This account cannot do that yet" }, { status: 403 }) };
  }

  return { session, rep };
}
