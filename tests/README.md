# Tests

Four suites, each answering a different question.

| Suite | Question | Needs a server | Writes to the database |
|---|---|---|---|
| `npm test` | Do the pure functions behave? | no | no |
| `npm run test:api` | Do the 48 API routes enforce the rules? | yes | yes |
| `npm run test:e2e` | Does the app work in a browser? | yes | yes |
| `npm run test:load` | How much load does it take? | yes | depends on profile |
| `tests/recon` | Is a deployed environment sound? | no (targets a URL) | **no** |

## The database these tests use

**This matters more than anything else here.** `.env.local` on this project points
at a live Atlas cluster. `next start` reads that file, so a browser suite or a
load test started the ordinary way would run against production data.

Everything in `tests/` therefore resolves its own connection string: the app's
`MONGODB_URI` with the database name replaced by `bhealix_crm_test`. Same
cluster, same credentials, a different database — which is what makes seeding
and truncating safe.

`tests/support/config.mjs` refuses to run at all if that resolution lands back
on `bhealix_crm`, or if the target host is not local. `ALLOW_PRODUCTION=1`
overrides both, deliberately and never by accident.

Start the server for tests with the script, not with `npm start`:

```bash
npm run build
npm run test:serve      # next start, with the test database in the environment
```

## Running them

```bash
npm run test:seed       # accounts, doctors and products in the test database
npm run test:api        # integration + security (seeds and cleans up itself)
npm run test:e2e        # browser suite (needs: npx playwright install chromium)
npm run test:load       # smoke by default
node tests/load/run.mjs stress --scale 2
```

The seeded accounts are `test-{admin,hr,mr,mr2,sales}@bhealix.test`, password
`TestOnly@12345` (override with `TEST_PASSWORD`). Two field accounts exist on
purpose: "can one rep read the other's records?" is unanswerable with one.

Everything the seeder creates carries a `__bhealix_test__` marker, and cleanup
deletes only marked records — so a run cannot remove data it did not create,
even if somebody points it at a database that has real data in it.

## Layout

```
tests/
  support/      config, cookie-jar HTTP client, seeder, shared constants
  api/          auth, the RBAC matrix, CRUD and validation
  security/     session forgery, IDOR, injection, upload abuse
  load/         engine, scenarios, profiles, runner
  e2e/          Playwright specs
  recon/        read-only check of a deployed environment
```

## The RBAC matrix

`tests/api/rbac.test.mjs` states the intended policy for every route by hand,
transcribed from `src/constants/access.ts` and the guard on each handler. It is
deliberately *not* derived from the `can` object the app uses — a table built
from the same source it is checking agrees with the code by construction and
catches nothing. Written out separately, a guard that gets loosened shows up as
a failure instead of as a matching change on both sides.

Each route is asserted three ways: anonymous callers get 401, roles outside the
policy get 403, and roles inside it get anything except a refusal.

Note that several handlers take a bare `apiSession()` and then check the role
themselves — `/api/customers`, `/api/inventory/*` and `/api/hr/overview` are
desk-only despite having no guard in the `apiSession` call, and `/api/team/:id`
and `/api/hr/salary/:id` additionally allow the owner. The table reflects the
effective policy, not the guard argument.

## Load profiles

| Profile | Shape | What it tells you |
|---|---|---|
| `smoke` | 1 user, 10s | The path works. Run before trusting any other number. |
| `load` | 5 → 15 → 30 users | p95 at the load you expect. |
| `stress` | 10 → 200 users | Where latency turns upward — the capacity figure. |
| `spike` | 5 → 150 → 5, twice | Survival, and whether it *recovers*. |
| `soak` | 10 users, 10 min | Leaks and drift a short run cannot see. |
| `login` | 2 → 20 users | bcrypt is CPU-bound; the morning sign-in rush. |

The generator is closed-loop: each virtual user waits for its answer before
issuing the next request. That models people using an app, and means throughput
falls out of latency rather than being dialled in. For a public endpoint facing
the internet an open-loop model would be the right choice; a few hundred reps is
not that.

`--scale N` multiplies every duration. `--json out.json` writes the raw stages.

## Tests that are currently red

Three tests fail against the code as it stands, and they are correct to. They
are documented in `docs/test-report.md`; briefly:

- every write endpoint returns **500** to a malformed or empty JSON body
- `/api/visits` returns **500** for an unparseable `from`/`to` filter
- a visit photo posted with **no location fields is accepted and stored at 0°, 0°**

Leaving them red is the point. A suite edited to assert the behaviour it found,
rather than the behaviour that is correct, stops being able to tell you when the
bug is fixed.
