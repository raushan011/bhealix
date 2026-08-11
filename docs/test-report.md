# Test report — BHEALIX CRM

Run on 8 August 2026 against `next start` (production build) on Windows 11,
Node 22.16, with MongoDB Atlas as the database. The read-only section was run
against `https://bhealix.vercel.app`.

## Summary

| Suite | Result |
|---|---|
| Unit (`npm test`) | 223 / 223 pass |
| RBAC across all 47 API routes | **213 / 213 pass** |
| Access control between reps (IDOR) | **16 / 16 pass** |
| Session forgery and JWT attacks | **9 / 9 pass** |
| Injection, upload abuse, disclosure | 18 / 21 pass |
| API integration and validation | 23 / 26 pass |
| Browser, desktop and mobile | **78 / 78 pass** |
| Load, stress and spike | no failed request at any level tested |
| Production, read-only | no unauthenticated access to any of 21 routes |

The integration and security suites total **286 passing of 292**. The six red
tests are the three defects below, each asserted twice; they are left failing on
purpose, because a suite edited to assert the behaviour it found stops being
able to tell you when the bug is fixed.

Authorisation is the part of this codebase most likely to be got wrong, and it
is the part that came out cleanest. Every route refuses an anonymous caller,
every role is held to its policy, and no representative could reach another's
visits, bills, photographs, profile or salary. The bugs below are all in input
handling, and one of them matters a great deal.

---

## Findings

### 1. A visit photo with no location is accepted and stored at 0°, 0°

**Severity: high.** This defeats the feature it lives inside.

`src/app/api/visits/[id]/photos/route.ts` requires every photo to carry the fix
the phone reported, and says why: a photo of a clinic front proves nothing
unless it says which clinic front. The guard reads

```js
const fix = completeFix({
  latitude: Number(form.get("latitude")),
  longitude: Number(form.get("longitude")),
  accuracy: Number(form.get("accuracy"))
});
if (!fix) return badRequest("A photo has to carry the location it was taken at…");
```

`form.get("latitude")` returns `null` when the field was never sent, and
`Number(null)` is `0`. Zero is a valid latitude and a valid longitude, so
`completeFix` returns a complete fix and the upload is accepted.

Verified end to end — posting a photo with no location fields at all:

```
upload status: 201
stored photo location: { "latitude": 0, "longitude": 0, "accuracy": 0, … }
```

That is Null Island, in the Gulf of Guinea — precisely the outcome the comment
above `fixFrom` describes as unacceptable. The consequence is that omitting two
form fields turns the location requirement off, and the resulting photo is
indistinguishable on screen from a genuinely located one.

The fix is to read the fields before coercing them, so an absent field stays
absent rather than becoming zero:

```js
const number = (field) => {
  const raw = form.get(field);
  return raw === null || raw === "" ? undefined : Number(raw);
};
```

`completeFix` already rejects `undefined` correctly — the JSON path in
`POST /api/visits` uses it through Zod and behaves properly. Only the multipart
path is affected.

Covered by `tests/security/injection.test.mjs` — "refuses a photo with no
location fix" and "does not store a photo at 0°, 0° when the fix was absent".

---

### 2. Every write endpoint returns 500 to a malformed or empty body

**Severity: medium.** Reachable in production.

`await request.json()` throws a `SyntaxError` on a body that is not JSON, and
`fail()` in `src/lib/api.ts` recognises `ZodError` and duplicate-key errors but
not this, so it falls through to the 500 branch. Twelve endpoints checked,
twelve affected:

```
POST /api/doctors              malformed=500  empty=500
POST /api/visits               malformed=500  empty=500
POST /api/plans                malformed=500  empty=500
POST /api/hr/leave             malformed=500  empty=500
POST /api/samples/movements    malformed=500  empty=500
POST /api/products             malformed=500  empty=500
POST /api/invoices             malformed=500  empty=500
POST /api/customers            malformed=500  empty=500
POST /api/team                 malformed=500  empty=500
POST /api/hr/attendance        malformed=500  empty=500
POST /api/hr/holidays          malformed=500  empty=500
PUT  /api/billing/settings     malformed=500  empty=500
```

Confirmed live: `POST https://bhealix.vercel.app/api/auth/login` with no body
returns **500**.

Nothing leaks — the response is the generic message and carries no stack trace,
which the disclosure tests confirm. But it is the wrong status for a client
error, it makes genuine 500s harder to spot in logs, and a rep on a flaky
connection that truncates a request sees "Something went wrong" rather than
anything actionable.

One line in `fail()` covers all twelve:

```js
if (error instanceof SyntaxError) return badRequest("That request could not be read");
```

---

### 3. Unparseable query parameters reach MongoDB and 500

**Severity: low-medium.** Any signed-in user can trigger it with a crafted URL.

`GET /api/visits` builds a date range straight from the query string:

```js
if (from) range.$gte = new Date(`${from}T00:00:00`);
```

`new Date("garbageT00:00:00")` is an Invalid Date, which the driver rejects.
Every one of these returns 500:

```
/api/visits?from=garbage        /api/visits?to=abc
/api/visits?from=9999-99-99     /api/visits?from=2024-13-45
/api/visits?to=garbage          /api/visits?from=%00
```

The same shape appears with an id-valued filter that cannot be cast:
`/api/visits?employee=%7B%22%24ne%22%3Anull%7D` (the *string* `{"$ne":null}`)
returns 500 on the cast.

Worth being clear about what this is and is not: it is **not** an injection.
The value arrives as a string, the ownership filter is still applied first, and
the equivalent probes returned no data — `tests/security/injection.test.mjs`
confirms a rep cannot widen their own visit list with `employee[$ne]=null`. It
is an unvalidated parameter producing a server error, which is a robustness and
log-noise problem rather than a disclosure one.

The other date-filtered endpoints (`/api/hr/attendance`, `/api/hr/leave`,
`/api/invoices`, `/api/samples/movements`, `/api/inventory/movements`,
`/api/reports`) all handle the same input without failing, so this is specific
to `/api/visits`.

---

### 4. Sign-in is not rate limited

**Severity: medium.** Both a guessing surface and a denial-of-service one.

Twelve wrong passwords in a row against the same account were all answered
`401`; no `429`, no delay, no lockout. The account-enumeration defence is sound
— an unknown address and a wrong password give byte-identical responses, which
the auth suite asserts — so this is about volume, not discovery.

The denial-of-service half is the more pressing one here. `bcrypt.compare` at
cost 12 is roughly 250–400 ms of CPU that cannot be cached or offloaded, and the
`login` load profile exists to measure exactly that. On a serverless deployment
it converts directly into billed compute; on a fixed instance a few dozen
concurrent attempts will saturate it.

---

### 5. A user record that fails schema validation cannot sign in

**Severity: low,** but sharp when it bites.

`POST /api/auth/login` records the sign-in with `user.lastLoginAt = new Date();
await user.save()`. Mongoose validates the *whole* document on save, so any
existing field that no longer satisfies the schema makes the save throw — after
the password has already been checked — and the user gets a 500 rather than a
session.

Found by accident: seeding a user with `employmentStatus: "Active"`, which is
not in `EMPLOYMENT_STATUSES`, made login fail with

```
User validation failed: employmentStatus: `Active` is not a valid enum value
```

Any record predating an enum change, or written by an import, is a person who
cannot log in and an error that says nothing about why. `User.updateOne({ _id },
{ $set: { lastLoginAt: new Date() } })` records the same fact without
revalidating fields the login has no business caring about.

---

### 6. Security headers missing in production

**Severity: low.** Hardening rather than a live hole.

Measured on `https://bhealix.vercel.app/login`:

| Header | Present |
|---|---|
| `strict-transport-security` | yes — `max-age=63072000; includeSubDomains; preload` |
| `x-frame-options` | **no** |
| `content-security-policy` | **no** |
| `x-content-type-options` | **no** |
| `referrer-policy` | **no** |

`x-content-type-options: nosniff` is the one to add first, and it interacts with
the upload path: visit photos are stored with the content type the client
claimed, and the type allow-list trusts `file.type`. The stored bytes are served
back with that type, so `nosniff` is what stops a browser second-guessing it.
These can go in `next.config.ts` under `headers()`.

---

## What was tested and passed

Worth recording explicitly, because absence of a finding is a result.

**Authorisation — 213 assertions, all passing.** Every one of the 47 routes was
called anonymously (must be 401), as each role outside its policy (must be 403),
and as each role inside it (must not be refused). The matrix is transcribed by
hand from `src/constants/access.ts` rather than derived from it, so it can
disagree with the code.

Seven routes turned out to be *more* restrictive than a reading of their
`apiSession()` call suggests — `/api/customers`, `/api/inventory/stock`,
`/api/inventory/movements` and `/api/hr/overview` check `viewAllBilling`,
`viewAllStock` and `viewHr` inside the handler, and `/api/team/:id` and
`/api/hr/salary/:id` allow the record's owner as well as the desk. The table was
corrected to match; the code was right.

**Access control between representatives — 16 assertions, all passing.** With
two field accounts seeded, a rep could not list, read, update or photograph
another rep's visit; could not see another's invoices; could not record a
payment against another's bill; could not read another's profile or salary;
could not approve their own leave; and could not promote themselves by editing
their own team record. Creating a visit with somebody else's `employee` id in
the body did not transfer ownership.

**Session integrity — 9 assertions, all passing.** Rejected: a token signed with
the wrong secret claiming `role: "ADMIN"`; a token signed with an empty key; a
token whose `role` was rewritten in place keeping the original signature; the
same with `userId`; `alg: none` with and without a trailing dot; an HS256 token
relabelled `RS256`; an expired token; and ten shapes of rubbish in the cookie.
The session cookie is `httpOnly` and `SameSite=Lax`.

**Injection and abuse.** `{ $ne: null }`, `{ $gt: "" }`, `{ $regex: ".*" }` and
`{ $where: "1==1" }` in place of the login identifier or password were all
refused with no cookie issued — the Zod schema is in front of the query.
`__proto__` and `constructor.prototype` in a request body did not pollute.
Regex metacharacters in the doctor search are escaped and return 200. Uploads
rejected SVG, HTML, PHP, executables and GIF; rejected a file over 3 MB; rejected
an empty file; rejected a burst exceeding the eight-photo limit. No endpoint
returned a password hash, a stack trace, a driver error or the connection string.

**Production, read-only.** All 21 API routes checked returned 401 to an
anonymous caller. No `x-powered-by`. Nothing sensitive in any response body.

---

## Performance

Measured locally against the production build, with the database on Atlas across
the internet — so these figures include a real network round trip per query and
are pessimistic relative to co-located hosting.

### Normal load

| Concurrent users | Throughput | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|
| 5 | 10.2 /s | 56 ms | 148 ms | 206 ms | 0% |
| 15 | 31.9 /s | 48 ms | 105 ms | 144 ms | 0% |
| 30 | 47.1 /s | 153 ms | 529 ms | 597 ms | 0% |

### Ramp to 200

| Concurrent users | Throughput | p50 | p95 | Max | Errors |
|---|---|---|---|---|---|
| 10 | 37.9 /s | 46 ms | 97 ms | 317 ms | 0% |
| 25 | 51.5 /s | 112 ms | 656 ms | 775 ms | 0% |
| 50 | 56.3 /s | 753 ms | 879 ms | 1.9 s | 0% |
| 100 | 59.8 /s | 1.26 s | 2.77 s | 5.8 s | 0% |
| 200 | 62.9 /s | 2.70 s | 4.78 s | 8.7 s | 0% |

**No request failed at any level, up to 200 concurrent users and 5,770 requests.**
Nothing dropped, nothing timed out, no connection-pool exhaustion. That is a
better result than most applications give on a first stress run.

**Throughput ceiling is about 60 requests per second.** It reaches ~52/s at 25
users and never meaningfully exceeds 63/s however many more are added — the
curve is flat from 50 users onward while latency climbs in proportion. That is
the signature of a saturated resource rather than a queue that collapses: extra
users get served, just more slowly and fairly.

**The knee is between 15 and 25 concurrent users**, where p95 goes from 97 ms to
656 ms. Below it the app is comfortable; above it every additional user is paid
for in latency by all of them.

Given the flat throughput and the absence of errors, the limit is almost
certainly the database round trip rather than CPU — each request makes one or
more Atlas queries over the public internet, and ~60/s is what that budget buys.
The two cheapest things to check before anything else:

1. **Where the app runs relative to the database.** Vercel's region and the
   Atlas cluster's region should match; a cross-region pair adds tens of
   milliseconds to every query and nothing in the code can win it back.
2. **`hr:leave` is consistently the slowest endpoint** at every level — p95 of
   600 ms at 30 users and 6.7 s at 200, well clear of the next one. Worth an
   `explain()` on the query behind it.

### Spike and recovery

A burst to 150 users, back to quiet, then the same burst again — the second half
being the point, because a system that survives a spike but stays slow after it
has a queue it never drains.

| Stage | Users | Throughput | p50 | p95 | Errors |
|---|---|---|---|---|---|
| baseline | 5 | 41.6 /s | 47 ms | 160 ms | 0% |
| spike | 150 | 59.5 /s | 1.96 s | 3.94 s | 0% |
| recovery | 5 | 39.9 /s | **50 ms** | 195 ms | 0% |
| second spike | 150 | 60.3 /s | 1.96 s | 3.93 s | 0% |
| settle | 5 | 40.5 /s | **48 ms** | 202 ms | 0% |

**Recovery is complete and immediate.** p50 returns to 50 ms the moment load
drops — against a 47 ms baseline — and the second spike behaves identically to
the first rather than worse. Nothing accumulates: no queue backlog, no leaked
connections, no degradation carried between bursts. Under the spike itself the
app slows down but keeps serving, and 4,940 requests produced no failures at all.

This is the healthiest result in the whole performance section. A morning where
every rep opens the app at once will be slow for a minute and then entirely
normal.

### Production baseline

`GET /login`, twelve sequential requests: first 116 ms, p50 **45 ms**, p95
116 ms. The first request was noticeably slower than the rest, which is a cold
start — expected on serverless, and worth knowing when a rep opens the app for
the first time that morning.

No load was generated against production. See below.

---

## Running any of this against production

The suite takes a `TEST_BASE_URL` and will point anywhere, but there are three
different things here and they carry very different risk.

**Safe now, no permission needed.** `node tests/recon/production-check.mjs <url>`
is read-only by construction: no sign-in, no writes, a few dozen requests. It is
what produced the production section above, and it is worth running after every
deploy.

**Needs credentials, low risk.** The API and browser suites can run against a
deployed environment if you create the five test accounts there. They write
records — doctors, visits, leave requests — all marked `__bhealix_test__` and
removed on teardown. Against production that still means test rows in real
tables for the length of the run, so a staging deployment is the better home.

**Needs a decision and a quiet window.** The `stress` and `spike` profiles exist
to find the point where the system degrades. Against production that means
deliberately degrading it for the reps in the field, and at 200 virtual users on
serverless it also means a real bill. If you want a capacity number for the live
deployment, the shape that gets it safely is: a staging deployment sized like
production, or the `load` profile only (never `stress`) against production at a
time when nobody is working, with somebody watching the Atlas and Vercel
dashboards.

The safety check in `tests/support/config.mjs` refuses a non-local target unless
`ALLOW_PRODUCTION=1` is set, so none of this can happen by forgetting a flag.

---

## Suggested order

1. The Null Island photo bug — it silently voids the evidence the visit-photo
   feature exists to produce, and it is a three-line fix.
2. The `SyntaxError` branch in `fail()` — one line, removes twelve 500s.
3. `nosniff` and the other headers in `next.config.ts` — one config block.
4. Rate limiting on `/api/auth/login`.
5. The date-filter 500 on `/api/visits`.
6. `updateOne` instead of `save()` for `lastLoginAt`.
7. Look at where the app runs relative to Atlas, and at the `hr:leave` query.
