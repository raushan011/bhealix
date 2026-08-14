/**
 * A fixed-window counter, for the two endpoints a stranger can reach.
 *
 * Everything else in this application is behind a session, where the account
 * itself is the limit. Affiliate registration and affiliate sign-in are not:
 * they are open to the internet, one of them writes a row and the other tests a
 * password. Neither should be free to call ten thousand times.
 *
 * **This is a speed bump, not a wall, and it is important to be honest about
 * why.** The counter lives in the memory of one server process. On Vercel that
 * means one lambda instance, so a burst spread across instances gets a fresh
 * allowance from each, and a deploy resets every window. Making it exact would
 * mean a shared store — Redis, or a collection with a TTL index — which is a
 * dependency this project does not otherwise have.
 *
 * It is proportionate because it is not the real defence. Registration cannot
 * grant anybody anything: a new account lands as `Pending` and an administrator
 * has to approve it before a single coupon can be minted. This exists to stop a
 * naive script filling the approvals queue, and to slow password guessing to the
 * point where the lockout is noticed.
 */

type Window = { count: number; resetAt: number };

/**
 * Kept on `globalThis` for the same reason the mongoose connection is: Next
 * reloads modules in development, and a fresh map on every reload would forget
 * every window it was holding.
 */
const globalWithBuckets = globalThis as typeof globalThis & { rateLimitBuckets?: Map<string, Window> };
const buckets = globalWithBuckets.rateLimitBuckets ?? new Map<string, Window>();
globalWithBuckets.rateLimitBuckets = buckets;

/** Nothing here is worth an unbounded map; the oldest windows go when it gets big. */
const MAX_KEYS = 5_000;

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number };

/**
 * Counts one attempt against `key`, allowing `limit` of them per `windowMs`.
 *
 * The window is fixed rather than sliding: at a hundred lines it would be a
 * worse-behaved version of the same speed bump, and the accuracy is not what
 * makes this useful.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_KEYS) {
    for (const [existing, window] of buckets) {
      if (window.resetAt <= now) buckets.delete(existing);
    }
    // Still full — every window is live. Drop the map rather than grow without
    // limit; the cost is one forgiven burst, which is the right way to fail.
    if (buckets.size > MAX_KEYS) buckets.clear();
  }

  const window = buckets.get(key);
  if (!window || window.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  window.count += 1;
  if (window.count > limit) return { ok: false, retryAfter: Math.ceil((window.resetAt - now) / 1000) };
  return { ok: true };
}

/**
 * The caller's address, as far as it can be known behind a proxy.
 *
 * `x-forwarded-for` is a list appended to by each hop; the first entry is the
 * original client. It is trivially spoofable in general — which matters less
 * here than it would for an authorisation decision, because the worst a forged
 * header buys is the allowance this function was going to grant anyway.
 */
export function callerKey(request: Request, prefix: string): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const address = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `${prefix}:${address}`;
}

/** The 429 both callers return, with the header a well-behaved client waits on. */
export const tooManyRequests = (retryAfter: number, message: string) =>
  Response.json({ error: message }, { status: 429, headers: { "retry-after": String(retryAfter) } });
