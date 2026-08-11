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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_API.includes(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  const token = request.cookies.get("bhealix_session")?.value;
  const secret = process.env.AUTH_SECRET;

  const signedOut = () => isApi
    ? NextResponse.json({ error: "Please sign in again" }, { status: 401 })
    : NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, request.url));

  if (!token || !secret) return signedOut();

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const role = String(payload.role);
    const deskRole = role === "ADMIN" || role === "HR";

    // Keep each role inside its own panel; page-level guards enforce finer rules.
    if (pathname.startsWith("/admin") && !deskRole) return NextResponse.redirect(new URL("/employee", request.url));
    if (pathname.startsWith("/employee") && deskRole) return NextResponse.redirect(new URL("/admin", request.url));

    const response = NextResponse.next();
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("x-frame-options", "DENY");
    response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
    return response;
  } catch {
    return signedOut();
  }
}

// /invoices and /payslips are printable documents reached by both panels, so
// they are guarded for a valid session but deliberately not confined to either
// one. Which of them a person may open is decided by the page itself.
//
// /choose is the desk's CRM chooser: it needs a session but belongs to neither
// panel, so it is matched here and confined by the page's own guard.
export const config = {
  matcher: ["/admin/:path*", "/employee/:path*", "/choose", "/invoices/:path*", "/payslips/:path*", "/api/:path*"]
};
