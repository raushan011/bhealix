import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * `/api/sales/shopify/webhook` is public because Shopify has no session with
 * us. It is not unauthenticated: the route verifies an HMAC over the raw body
 * against the app's client secret and refuses anything that does not match.
 * Leaving it behind the session gate would have every delivery answered with a
 * 401 until Shopify gave up and removed the subscription.
 */
const PUBLIC_API = ["/api/auth/login", "/api/auth/logout", "/api/sales/shopify/webhook"];

/**
 * The affiliate portal's own front door, which by definition has to be
 * reachable by somebody with no account at all.
 *
 * Neither endpoint grants anything. Registering creates a `Pending` record that
 * cannot hold a coupon or earn a rupee until an administrator approves it, and
 * signing in is a password check. Logout is here so that a session which has
 * gone bad can still be cleared rather than trapping somebody behind a cookie
 * the server will not accept.
 */
const PUBLIC_PARTNER = ["/partner/login", "/partner/register", "/api/partner/login", "/api/partner/register", "/api/partner/logout"];

const HEADERS: [string, string][] = [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "strict-origin-when-cross-origin"]
];

const pass = () => {
  const response = NextResponse.next();
  for (const [name, value] of HEADERS) response.headers.set(name, value);
  return response;
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const secret = process.env.AUTH_SECRET;

  /*
   * The affiliate portal is decided first and handled entirely on its own.
   *
   * Two cookies, two audiences, and no shared branch between them — see
   * `lib/auth/partner.ts` for why. The practical consequence is here: a staff
   * token reaching `/partner` is refused for want of the partner cookie, and a
   * partner token reaching `/admin` falls through to the staff branch below and
   * is refused for want of the staff one. Neither outcome depends on anybody
   * remembering to write a role check.
   */
  if (pathname === "/partner" || pathname.startsWith("/partner/") || pathname.startsWith("/api/partner")) {
    return partnerGate(request, pathname, secret);
  }

  if (PUBLIC_API.includes(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  const token = request.cookies.get("bhealix_session")?.value;

  const signedOut = () => isApi
    ? NextResponse.json({ error: "Please sign in again" }, { status: 401 })
    : NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, request.url));

  if (!token || !secret) return signedOut();

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    // An affiliate token is not a staff session, whatever cookie carried it.
    // The same refusal `getSession` makes, at the edge, so a partner token
    // cannot even reach a staff route handler.
    if (payload.aud === "partner") return signedOut();

    const role = String(payload.role);
    const deskRole = role === "ADMIN" || role === "HR";

    // Keep each role inside its own panel; page-level guards enforce finer rules.
    if (pathname.startsWith("/admin") && !deskRole) return NextResponse.redirect(new URL("/employee", request.url));
    if (pathname.startsWith("/employee") && deskRole) return NextResponse.redirect(new URL("/admin", request.url));

    return pass();
  } catch {
    return signedOut();
  }
}

/**
 * The gate on everything under `/partner`.
 *
 * Identity only. Whether the affiliate behind a valid cookie is *approved* is
 * decided in the route handlers and the page guard, against the database, on
 * every request — a token lasts a week and a suspension has to bite on the next
 * tap, not whenever it happens to expire. Middleware is not where a stale claim
 * gets to be authoritative.
 */
async function partnerGate(request: NextRequest, pathname: string, secret: string | undefined) {
  const token = request.cookies.get("bhealix_partner")?.value;
  const isApi = pathname.startsWith("/api/");
  const isPublic = PUBLIC_PARTNER.includes(pathname);

  let signedIn = false;
  if (token && secret) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secret), { audience: "partner" });
      signedIn = true;
    } catch {
      signedIn = false;
    }
  }

  if (isPublic) {
    /*
     * Somebody already signed in who lands on the login form is sent to the
     * portal rather than being asked to sign in twice — *unless* they arrived
     * with `?ended=1`, which is the portal turning a suspended rep out.
     *
     * Without that exception the two guards fight each other: their token is
     * still a valid signature, so this would send them back to `/partner`, where
     * the page guard would read their standing from the database and send them
     * here again, for ever. The token cannot be cleared during a page render
     * (see `requirePartner`), so the login screen clears it on arrival and this
     * gets out of the way while it does.
     */
    const endedSession = request.nextUrl.searchParams.get("ended") === "1";
    if (signedIn && !endedSession && (pathname === "/partner/login" || pathname === "/partner/register")) {
      return NextResponse.redirect(new URL("/partner", request.url));
    }
    return pass();
  }

  if (!signedIn) {
    return isApi
      ? NextResponse.json({ error: "Please sign in again" }, { status: 401 })
      : NextResponse.redirect(new URL(`/partner/login?next=${encodeURIComponent(pathname)}`, request.url));
  }

  return pass();
}

// /invoices and /payslips are printable documents reached by both panels, so
// they are guarded for a valid session but deliberately not confined to either
// one. Which of them a person may open is decided by the page itself.
//
// /choose is the desk's CRM chooser: it needs a session but belongs to neither
// panel, so it is matched here and confined by the page's own guard.
//
// /partner is the affiliate portal, which has its own cookie and its own gate.
// Its public pages are matched too — they have to be, so that a signed-in rep
// landing on the login form can be sent onwards.
export const config = {
  matcher: [
    "/admin/:path*",
    "/employee/:path*",
    "/partner",
    "/partner/:path*",
    "/choose",
    "/invoices/:path*",
    "/payslips/:path*",
    "/api/:path*"
  ]
};
