import { jwtVerify, SignJWT, type JWTPayload } from "jose";

/**
 * The session token itself, kept apart from `next/headers` so the middleware —
 * which runs at the edge and has no request-scoped `cookies()` — can mint and
 * check the same token the route handlers do.
 *
 * **Sessions slide.** A token carries two clocks: `exp`, the ordinary expiry,
 * which is the *idle* limit — how long somebody can leave the tab alone before
 * they are asked to sign in again — and `start`, the moment the session was
 * first opened, which caps how long a session can be kept alive by activity at
 * all. Every request the middleware sees on a token older than
 * `REFRESH_AFTER` is answered with a fresh token that pushes `exp` forward and
 * keeps `start` where it was. Somebody who uses the CRM every day therefore
 * stays signed in; somebody who does not is signed out after the idle limit;
 * and nobody stays signed in past the absolute one without typing a password.
 *
 * Refreshing at most every ten minutes rather than on every request is a
 * bandwidth and cookie-write economy, not a security choice — a token ten
 * minutes stale is refreshed by the next click.
 */

/** Staff: three days idle, thirty days at the outside. */
export const STAFF_IDLE_SECONDS = 3 * 24 * 60 * 60;
export const STAFF_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60;

/** Affiliates, on their own phones: a fortnight idle, ninety days at the outside. */
export const PARTNER_IDLE_SECONDS = 14 * 24 * 60 * 60;
export const PARTNER_ABSOLUTE_SECONDS = 90 * 24 * 60 * 60;

/** How old a token must be before a request re-mints it. */
export const REFRESH_AFTER_SECONDS = 10 * 60;

export const STAFF_COOKIE = "bhealix_session";
export const PARTNER_COOKIE = "bhealix_partner";
export const PARTNER_AUDIENCE = "partner";

export type SessionKind = "staff" | "partner";

const LIMITS: Record<SessionKind, { idle: number; absolute: number; audience?: string }> = {
  staff: { idle: STAFF_IDLE_SECONDS, absolute: STAFF_ABSOLUTE_SECONDS },
  partner: { idle: PARTNER_IDLE_SECONDS, absolute: PARTNER_ABSOLUTE_SECONDS, audience: PARTNER_AUDIENCE }
};

export const encodeSecret = (value: string) => new TextEncoder().encode(value);

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Mints a token. `start` is carried over on a refresh and set to now on a
 * fresh sign-in; the two are the same call so the claims cannot drift.
 */
export async function signSessionToken(
  kind: SessionKind,
  claims: Record<string, unknown>,
  secret: Uint8Array,
  options: { start?: number; now?: number } = {}
): Promise<string> {
  const now = options.now ?? nowSeconds();
  const start = options.start ?? now;
  const limits = LIMITS[kind];

  const jwt = new SignJWT({ ...claims, start })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    // Never past the absolute limit, however recently it was refreshed.
    .setExpirationTime(Math.min(now + limits.idle, start + limits.absolute));
  if (limits.audience) jwt.setAudience(limits.audience);
  return jwt.sign(secret);
}

/** The cookie flags, in one place so login, refresh and registration cannot disagree. */
export function sessionCookieOptions(kind: SessionKind, secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: LIMITS[kind].idle
  };
}

/** When the session was first opened, or the token's own issue time for tokens minted before `start` existed. */
export const sessionStartOf = (payload: JWTPayload): number =>
  typeof payload.start === "number" ? payload.start : (payload.iat ?? nowSeconds());

/** Past the absolute limit — activity can no longer keep it alive. */
export function sessionExhausted(kind: SessionKind, payload: JWTPayload, now = nowSeconds()): boolean {
  return now >= sessionStartOf(payload) + LIMITS[kind].absolute;
}

/** Old enough to be worth re-minting, and still allowed to be. */
export function shouldRefresh(kind: SessionKind, payload: JWTPayload, now = nowSeconds()): boolean {
  if (sessionExhausted(kind, payload, now)) return false;
  const issued = payload.iat ?? 0;
  return now - issued >= REFRESH_AFTER_SECONDS;
}

/**
 * Verifies a token and, when it is due, returns the replacement to set.
 *
 * Returns null for anything that should be treated as signed out: a bad
 * signature, an expired token, the wrong audience, or a session past its
 * absolute limit. The caller decides what signed out means for its route.
 */
export async function verifySession(kind: SessionKind, token: string, secret: Uint8Array, now = nowSeconds()):
  Promise<{ payload: JWTPayload; refreshed: string | null } | null> {
  try {
    const limits = LIMITS[kind];
    const { payload } = await jwtVerify(token, secret, limits.audience ? { audience: limits.audience } : {});
    // A partner token is never a staff session, whatever cookie carried it.
    if (kind === "staff" && payload.aud === PARTNER_AUDIENCE) return null;
    if (sessionExhausted(kind, payload, now)) return null;

    if (!shouldRefresh(kind, payload, now)) return { payload, refreshed: null };

    // Everything but the registered claims is carried forward as it was.
    const { iat: _iat, exp: _exp, aud: _aud, start, ...claims } = payload;
    void _iat; void _exp; void _aud;
    const refreshed = await signSessionToken(kind, claims, secret, { start: typeof start === "number" ? start : payload.iat, now });
    return { payload, refreshed };
  } catch {
    return null;
  }
}
