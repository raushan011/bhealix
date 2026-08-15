# BHEALIX CRM — Codebase Map

**Purpose of this file.** A single, complete description of this repository, written so that a
language model (or a new developer) can plan and write correct changes *without opening the codebase
first*. Everything structural — models, fields, indexes, routes, permissions, invariants, file
locations — is here. Read this, decide which 2–5 files your task touches, then open only those.

**How to use it**

| You want to… | Do this |
|---|---|
| Understand the product | §1, §2 |
| Know where a file lives | §3 |
| Understand *why* the code is shaped this way | §4 — **read this before changing anything** |
| Work on permissions or auth | §5 |
| Work with the database | §6 |
| Call, change or add an HTTP endpoint | §7 |
| Change business arithmetic (GST, payroll, stock, routing) | §8 |
| Work on the affiliate/Sales CRM | §1, §6.15, §7.9, §8.8 |
| Work on screens/components | §9 |
| Write new code in-house style | §10 |
| Avoid a known trap | §11 |
| Jump straight to the files for a task | §12 |

Conventions in this file: `path/to/file.ts` is relative to the repo root. Field tables list
`name : type` with defaults and notes. "Guard" means the permission predicate an API route enforces.

---

## 1. What the product is

A CRM for **BHEALIX**, an Indian skincare pharma brand. It covers the full life of a field sales
operation:

1. **Doctor discovery** — find skin specialists via Google Places, save them to a directory, import/export Excel.
2. **Call scheduling** — record which days and time-windows each doctor sees medical representatives.
3. **Route planning** — order a day's doctors by *call time first, distance second*.
4. **Field visits** — check in with GPS, log outcome, samples handed over, interest, order value, photos.
5. **GST billing** — tax invoices and bills of supply, part payments, payment proof, printable PDF.
6. **Inventory** — one stock pool per product, drawn down by both sales and sample issues.
7. **HR** — employment records, attendance, leave, holidays.
8. **Payroll** — effective-dated salaries, monthly runs, statutory deductions, payslips.
9. **Reporting** — per-rep field activity and an audit trail of everything a rep changed.
10. **Affiliate sales** — coupon-attributed Shopify orders, Shiprocket delivery status, automatic
    commission and weekly payout runs.

Two panels, one app: `/admin` (desktop, for ADMIN + HR) and `/employee` (mobile PWA, for MR + SALES).

### Two CRMs share the desk panel

The desk panel holds two operations that barely touch, and a signed-in desk role is asked which they
came for (`/choose`):

| | **Doctor CRM** (`/admin`) | **Sales CRM** (`/admin/sales`) |
|---|---|---|
| Who sells | Employed medical representatives | Outside affiliates on commission |
| Where | Clinics, in person | The Shopify storefront |
| Paid by | Payroll | Weekly commission payout runs |
| Domains | 1–9 above | 10 above |

**There is no stored preference.** `lib/workspace.ts::workspaceOf(pathname)` decides which CRM the
shell is describing, so a bookmark, an emailed link and the back button all land somewhere that
agrees with itself. A cookie would eventually disagree with the URL, and the sidebar would describe
a different application from the one on screen. `landingFor(role)` (in `constants/access.ts`) sends
desk roles to the chooser on sign-in; `homeFor(role)` is unchanged and still what a panel guard uses
to bounce somebody.

### Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 App Router, React 19, server components by default |
| Language | TypeScript 5.9, `strict: true`, path alias `@/*` → `./src/*` |
| Database | MongoDB via Mongoose 8 |
| Auth | JWT in an HTTP-only cookie (`jose`), bcrypt password hashes |
| Validation | Zod 4 on every write path |
| Styling | Tailwind CSS 4 (via `@tailwindcss/postcss`) |
| Forms | react-hook-form + `@hookform/resolvers` |
| Charts | recharts |
| Excel | `xlsx` |
| Icons | `lucide-react` |
| Tests | vitest + @testing-library/react + jsdom |
| Hosting | Vercel + MongoDB Atlas (intended) |

### Commands

```bash
npm run dev                # dev server on :3000
npm run build              # production build
npm start                  # serve the build
npm run seed               # create admin account, migrate old call schedules (safe to re-run)
npm run icons              # regenerate PWA icons from the brand mark
npm run backfill:samples   # rebuild the sample ledger from historic visits
npm run typecheck          # tsc --noEmit
npm run lint               # eslint
npm test                   # vitest run
```

### Environment variables (`.env.example`)

| Name | Required | Notes |
|---|---|---|
| `MONGODB_URI` | yes | e.g. `mongodb://127.0.0.1:27017/bhealix_crm` |
| `AUTH_SECRET` | yes | ≥32 chars; signs the session JWT |
| `NEXT_PUBLIC_APP_URL` | yes | absolute URL, validated as a URL |
| `NEXT_PUBLIC_COMPANY_NAME` | no | defaults to `BHEALIX` |
| `GOOGLE_MAPS_SERVER_API_KEY` | for discovery | Places API (New) + Geocoding API |
| `SEED_DEMO_STAFF` | no | `1` creates throwaway MR/HR/SALES accounts when seeding |
| `CRON_SECRET` | for the nightly pass | Bearer token accepted by `GET /api/sales/cron`; `vercel.json` schedules it at 01:30 |

The Shopify and Shiprocket credentials are **not** environment variables — they are entered under
Sales settings and stored encrypted (§6.15), so they change without a redeploy. Note `AUTH_SECRET`
now does double duty: it signs the session *and* derives the key those two are encrypted with.

Validated by `src/lib/env.ts` (`env()` parses `process.env` through a Zod schema).
Seed admin: `admin@bhealix.com` / `Bhealix@123` — **change before production**.

---

## 2. The nine domains at a glance

| Domain | Collections | Pure logic | Server logic | API prefix |
|---|---|---|---|---|
| Auth | `User` | `constants/access.ts` | `lib/auth/*` | `/api/auth` |
| Doctors | `Doctor` | `lib/doctors/{fields,call-schedule,discovery}` | `lib/doctors/places.ts` | `/api/doctors`, `/api/google` |
| Route plans | `RoutePlan` | `lib/routing.ts` | `lib/plans.ts` | `/api/plans` |
| Visits | `Visit`, `VisitPhoto` | `lib/visits.ts` | — | `/api/visits` |
| Samples | `SampleMovement` | `lib/samples/movements.ts` | `lib/samples/ledger.ts` | `/api/samples` |
| Inventory | `StockMovement`, `Product` | `lib/inventory/movements.ts` | `lib/inventory/ledger.ts` | `/api/inventory`, `/api/products` |
| Billing | `Invoice`, `Customer`, `PaymentProof`, `BillingSettings`, `Counter` | `lib/billing/{constants,gst,numbering,types,customers,attachments,follow-ups}` | `lib/billing/{invoices,compose}.ts` | `/api/invoices`, `/api/customers`, `/api/billing` |
| HR | `LeaveRequest`, `Attendance`, `Holiday` | `lib/hr/{leave,attendance}` | `lib/hr/records.ts` | `/api/hr/{leave,attendance,holidays,overview}` |
| Payroll | `SalaryStructure`, `PayrollRun`, `Payslip`, `PayrollSettings` | `lib/hr/payroll.ts` | `lib/hr/payroll-run.ts` | `/api/hr/{payroll,payslips,salary}` |
| Affiliate sales | `SalesRep`, `SalesOrder`, `SalesPayout`, `SalesPayoutLine`, `SalesLead`, `SalesSettings` | `lib/sales/{constants,coupons,commission,delivery,payouts,leads,fulfilment,types}` | `lib/sales/{settings,shopify,shiprocket,sync,booking,payout-run,reporting,secrets,http,reps}` | `/api/sales/*` |
| Audit | `AuditEvent` | — | `lib/audit.ts` | — (written inline) |

**The pure/server split is a rule, not an accident.** Files listed under "pure logic" contain no
Mongoose and no React, so both the browser bundle and the server can import them and compute the
same answer. See §4.1.

---

## 3. Directory map

```
src/
├── middleware.ts                    Edge auth gate + security headers; panel routing by role
├── app/
│   ├── layout.tsx  page.tsx  error.tsx  not-found.tsx  manifest.ts
│   ├── login/page.tsx
│   ├── admin/                       Desktop panel — ADMIN + HR (layout.tsx = AdminShell)
│   │   ├── page.tsx                 dashboard
│   │   ├── discover/                Google Places doctor search + Excel import/export
│   │   ├── doctors/{page,new,[id]}
│   │   ├── plans/{page,new,[id]}
│   │   ├── visits/page.tsx
│   │   ├── samples/page.tsx         per-rep sample stock matrix
│   │   ├── products/page.tsx        catalogue + units-available box
│   │   ├── inventory/page.tsx       warehouse ledger + stock levels
│   │   ├── customers/page.tsx       trade buyer directory
│   │   ├── billing/{page,new,[id],[id]/edit,settings}
│   │   ├── team/{page,[id],[id]/activity}
│   │   ├── hr/{page,attendance,leave,holidays,payroll,payroll/[id],payroll/settings}
│   │   ├── reports/page.tsx
│   │   └── sales/                   The Sales CRM (layout.tsx guards can.viewSales)
│   │       ├── page.tsx             affiliate dashboard
│   │       ├── leads/page.tsx       Google Places business search + the saved lead list
│   │       ├── reps/{page,[id]}
│   │       ├── orders/page.tsx      what the coupons brought in
│   │       ├── orders/process/      the picking list (page guards can.processOrders)
│   │       ├── payouts/{page,[id]}
│   │       └── settings/{page,layout}   layout guards can.manageSales
│   ├── choose/page.tsx              Doctor CRM or Sales CRM — the desk's landing page
│   ├── employee/                    Mobile PWA panel — MR + SALES (layout.tsx = FieldShell)
│   │   ├── page.tsx                 Today: the day's route in visiting order
│   │   ├── plans/{page,new,[id]}    rep plans their own round
│   │   ├── doctors/{page,new,[id]}
│   │   ├── visits/[id]/page.tsx     check in, log outcome, photos
│   │   ├── bills/{page,[id]}        own bills, collect payment
│   │   ├── samples/page.tsx  history/  leave/  payslips/  profile/  more/
│   ├── invoices/[id]/print/page.tsx Printable bill — outside both panels
│   ├── payslips/[id]/print/page.tsx Printable payslip — outside both panels
│   └── api/                         see §7
├── components/
│   ├── ui/          kit.tsx (design system), modal.tsx, brand.tsx, password-input.tsx
│   ├── layout/      admin-shell.tsx, field-shell.tsx, sign-out-button.tsx
│   ├── billing/     bill-form, customer-form, customer-picker, follow-up-editor,
│   │                invoice-document, invoice-row, invoice-view, payment-form,
│   │                payment-proof, payment-qr, print-button
│   ├── sales/       sync-button, rep-form, order-list, import-orders, automation-panel,
│   │                leads-screen, lead-search, lead-list
│   ├── doctors/     call-schedule-editor, doctor-call-time-card, doctor-details-form, doctor-picker
│   ├── visits/      visit-form, visit-photos
│   ├── plans/       plan-assignment, delete-plan-button
│   ├── hr/          payslip-document, salary-card
│   └── pwa/         service-worker, install-prompt, connection-status
├── constants/access.ts              ROLES, panel predicates, the whole `can.*` table
├── lib/
│   ├── api.ts                       ok/badRequest/fail/pageParams/OBJECT_ID
│   ├── audit.ts                     AUDIT_ACTIONS + record()
│   ├── env.ts  time.ts  maps.ts  routing.ts  plans.ts
│   ├── auth/        session.ts (JWT), guard.ts (requireSession/apiSession)
│   ├── db/          mongoose.ts (cached connection + model registration)
│   ├── billing/     constants, gst, numbering, types, customers, attachments, invoices, compose
│   ├── doctors/     fields, call-schedule, discovery, places
│   ├── hr/          leave, attendance, payroll, payroll-run, records
│   ├── inventory/   movements, ledger
│   ├── samples/     movements, ledger
│   ├── sales/       constants, coupons, commission, delivery, payouts, leads,
│   │                fulfilment, types                                            (pure)
│   │                secrets, http, shopify, shiprocket, settings, sync, booking,
│   │                payout-run, reporting, reps                                (server)
│   └── workspace.ts Which CRM a path belongs to
├── models/                          One file per bounded context — see §6
└── (tests co-located as *.test.ts next to what they test)
public/    sw.js, offline.html, icons/, brand/
scripts/   seed.mjs, generate-icons.mjs, backfill-sample-ledger.mjs
```

---

## 4. Architecture invariants

These are the rules the codebase is built on. Violating one produces a bug that looks like something
else. **Read this section before writing code.**

### 4.1 Pure logic never imports Mongoose or React

`lib/billing/gst.ts`, `lib/hr/payroll.ts`, `lib/hr/leave.ts`, `lib/hr/attendance.ts`,
`lib/samples/movements.ts`, `lib/inventory/movements.ts`, `lib/routing.ts`, `lib/time.ts`,
`lib/billing/constants.ts`, `lib/visits.ts` are all framework-free. The browser and the server
import the same function, so the total on screen and the total stored can never disagree. Enum
constants (`LEAVE_TYPES`, `PAYMENT_MODES`, …) live here too and are imported *by* the models.

Adding arithmetic? Put it in a pure module and call it from both sides. Never reimplement it.

### 4.2 Money and quantities are computed on the server, never trusted from the client

Invoice line figures (`gross`, `taxableValue`, `cgst`, `sgst`, `igst`, `total`) and every payroll
number are recomputed server-side from the raw inputs. The client sends quantity, rate, discount and
GST rate; it does not send totals.

### 4.3 Ledgers are append-only rows; balances are always derived

Both `SampleMovement` (per-rep) and `StockMovement` (warehouse) store a **signed** `quantity`. A
balance is `$sum: "$quantity"` — never a stored column. Consequences:

- Product "units available" on the catalogue screen is a ledger balance, not a field on `Product`.
  Typing a new figure writes the *difference* (`setStockLevel` → `levelChange`).
- Derived rows are **delete-then-insert**, never appended: `syncInvoiceStock(invoice)` and
  `syncDispenseLedger(visit)` delete that document's rows first. This makes re-submitting idempotent,
  and makes cancelling an invoice or marking a visit missed return the stock automatically.
- Both ledgers key on **`productName`**, not the product reference, because the catalogue retires
  rather than deletes. Renaming a product must call `renameProductInLedgers(from, to)` or the pool
  splits in two.
- The two ledgers meet at exactly one point: issuing samples to a rep writes an `ISSUE` row in the
  sample ledger and a mirrored `SAMPLE_ISSUE` row in the warehouse ledger (`mirrorSampleMovements`).

### 4.4 Cached totals exist, and one function maintains them

`Invoice.amountPaid`, `balanceDue` and `status` are a cache of `payments[]`, so a list of a hundred
invoices can sort by what is owed without re-adding every receipt. **Anything that touches
`invoice.payments` must call `recalculate(invoice)` from `lib/billing/invoices.ts` before saving.**

`Invoice.followUpDate` is the same idea for chasing: a mirror of the earliest entry in `followUps[]`
that nobody has marked made, so a hundred bills can be indexed and sorted by "who needs calling"
without unpacking an array per row. **Anything that touches `invoice.followUps` must go through
`lib/billing/follow-ups.ts`** — `applyFollowUps`, `appendFollowUp`, `setFollowUpDate` and
`syncFollowUpDate` all re-derive the mirror before returning.

### 4.5 Documents that are evidence store a snapshot, not a reference

- `Invoice.billTo` copies the buyer's name/address/GSTIN at billing time. A reprint two years later
  must show what was actually charged.
- `Invoice.items[]` stores every computed figure, not a live join to the catalogue.
- `Payslip.snapshot` copies name, designation, PAN, UAN, bank name and the **last four digits** of
  the account. A payslip must still read correctly after a raise, a transfer or a name change.
- `PayrollRun.lopBasis` is frozen onto the run so a later policy change cannot restate an old month.

### 4.6 Large binaries live in their own collection with `select: false`

`VisitPhoto.data`, `PaymentProof.data` and `BillingSettings.paymentQr` are all `select: false`.
Screens that list or count read the metadata only (`bytes`, `contentType`, `uploadedAt`); exactly one
route per binary fetches the bytes with an explicit `.select("+field")`. Metadata is *also* copied
onto the parent (e.g. `Invoice.payments[].proof`) so a list renders without a second query.

Those three routes all read with `.lean()`, which skips Mongoose's casting and hands back the driver's
BSON `Binary` wrapper — **not** a `Buffer`. Its `length` is a *method*, so `!doc.data?.length` is
always false and `new Uint8Array(binary)` is silently empty: a 200 with the right content type and
zero bytes, which a browser shows as a broken image. Always unwrap with `storedBytes()`
(`lib/db/bytes.ts`) and check `bytes.byteLength`.

### 4.7 Calendar days are `"yyyy-mm-dd"` strings; months are `"yyyy-mm"`

Leave dates, attendance dates, holidays, joining/exit dates and `effectiveFrom` are all strings. A
day off is the whole of that day wherever the server runs — a `Date` would drag a timezone into a
question that has none. String comparison (`date >= from && date <= to`) is the intended idiom.

Real instants (`invoiceDate`, `occurredAt`, `checkInAt`) *are* `Date`, and form values are converted
with `fromDateInput()` which anchors at **local midday**, never midnight (§11).

### 4.8 Permission is decided on the server, every time

`constants/access.ts` exports one `can.*` predicate per action. The middleware only keeps roles in
their own panel; page guards (`requireAdminPanel` / `requireFieldPanel`) and API guards
(`apiSession(can.x)`) do the real work. The UI never decides access on its own — it merely hides
what the server would refuse.

Ownership is checked separately from role: a rep passing `can.recordPayment` still has to own the
invoice.

### 4.9 Separation of duty in payroll

`can.runPayroll` (ADMIN + HR) prepares a month. `can.approvePayroll` (ADMIN only) approves and
releases it. This is deliberate and must not be collapsed.

### 4.10 Records are archived, not deleted, once anything references them

Doctors are archived (`status: "Archived"`). Products are retired (`active: false`) once used, and
deleted outright only if never referenced. Employees are deactivated; deletion is refused for anyone
with recorded visits and for the last administrator. Invoices are cancelled (keeping their number)
once money has been received; deletion is only possible before any payment.

### 4.11 One settings document per area, created on first read

`BillingSettings` (`key: "billing"`) and `PayrollSettings` (`key: "payroll"`) are singletons fetched
with `findOneAndUpdate(..., { upsert: true, setDefaultsOnInsert: true })` — `loadSettings()` and
`loadPayrollSettings()`. Screens never handle an empty state.

### 4.12 The audit trail is written separately from the change

`lib/audit.ts` `record()` writes one `AuditEvent` per meaningful action and **swallows its own
failures on purpose** — a rep in a clinic corridor must never lose a completed visit because writing
its audit line went wrong. Documents show only their latest state; the trail is how you learn a call
time was corrected three times.

### 4.13a A commission a payout run has claimed is never recomputed

`SalesOrder.commission` is a cache of `lib/sales/commission.ts`, and **`recalculateCommission` is the
only thing that writes it** — the same rule `recalculate()` has for an invoice (§4.4). Anything that
changes a delivery state, a refund or a commission rate calls it and saves.

What it will *not* do is restate a commission whose status is `In payout` or `Paid`. That run is a
document somebody approved, and recomputing what it contains underneath it would make the approval
meaningless. Instead the order is flagged `commission.needsReversal` and surfaced on the dashboard,
because money already sent is recovered by agreement — as a named negative adjustment on a later
run — and never by a background job editing a settled one.

Releasing is the run's own business: deleting or reopening a draft hands its commissions back
(`releaseRun`) and re-prices them on the way out, so a parcel that went RTO while the draft sat there
comes back as `Void` rather than as payable money.

### 4.13b Maturity is answered by the clock, not by whether a job ran

A commission becomes payable because seven days went by. Nothing happens to the order; the seventh
day simply arrives. So `payout-run.ts::matured()` matches on **`maturesAt <= end` with a status of
`Maturing` *or* `Payable`**, rather than on rows already stored as `Payable`.

Written the other way, a commission that matured overnight would be invisible to the payout until
something happened to recompute it, and a rep would silently wait a week for money they were already
owed. `GET /api/sales/cron` re-prices everything open on a schedule so the *screens* agree too, but
the run is correct whether or not it ever ran.

### 4.13 Every schema is registered in one place

`lib/db/mongoose.ts` imports every model so `populate()` always resolves. Without this, a route that
populates a reference it does not itself import throws `MissingSchemaError` — but only on a cold
server, which makes it look intermittent. **Add new models to that import list.**

---

## 5. Auth, roles and permissions

### 5.1 Session

- Cookie `bhealix_session`, HS256 JWT signed with `AUTH_SECRET`, **12-hour** expiry.
- Payload: `{ userId, name, role }`.
- `lib/auth/session.ts` — `createSessionToken()`, `getSession()`, `SESSION_COOKIE`.
- Legacy tokens without `name` are tolerated: `guard.ts::withName()` fills it from the database
  rather than signing the person out.

### 5.2 Guards

| Helper | File | Use |
|---|---|---|
| `requireSession()` | `lib/auth/guard.ts` | any page; redirects to `/login` |
| `requireAdminPanel()` | ″ | `/admin` pages; field staff redirected to `/employee` |
| `requireFieldPanel()` | ″ | `/employee` pages |
| `apiSession(allow?)` | ″ | route handlers; returns `{session}` **or** `{response}` |

Route-handler idiom, used everywhere:

```ts
const auth = await apiSession(can.manageBilling);
if ("response" in auth) return auth.response;    // 401 or 403 already built
// auth.session.userId / .role / .name
```

### 5.3 Middleware (`src/middleware.ts`)

Matches `/admin/*`, `/employee/*`, `/choose`, `/invoices/*`, `/payslips/*`, `/api/*`. Public:
`/api/auth/login`, `/api/auth/logout`. Verifies the JWT; on failure returns 401 for API paths and redirects to
`/login?next=…` for pages. Keeps desk roles (`ADMIN`, `HR`) out of `/employee` and field roles out of
`/admin`. Sets `x-content-type-options: nosniff`, `x-frame-options: DENY`,
`referrer-policy: strict-origin-when-cross-origin`.

`/invoices` and `/payslips` are deliberately reachable by both panels — the page itself decides who
may open that particular document. `/choose` belongs to neither and is confined by its own guard.

### 5.4 The permission table (`src/constants/access.ts`)

Roles: `ADMIN`, `HR`, `MR`, `SALES`.
`usesAdminPanel` = ADMIN | HR. `usesFieldPanel` = MR | SALES. `homeFor(role)` → `/admin` or `/employee`.

| `can.*` | ADMIN | HR | MR | SALES | Meaning |
|---|:-:|:-:|:-:|:-:|---|
| `manageDoctors` | ✓ | | | | edit/archive doctors; also gates products |
| `addDoctors` | ✓ | | ✓ | ✓ | add to the directory |
| `updateCallTime` | ✓ | | ✓ | ✓ | correct a doctor's call window |
| `planRoutes` | ✓ | | | | plan for somebody else and assign |
| `planOwnRoute` | | | ✓ | ✓ | a rep builds their own round |
| `logVisits` | | | ✓ | ✓ | |
| `viewAllReports` | ✓ | | | | |
| `manageEmployees` | ✓ | ✓ | | | |
| `viewHr` | ✓ | ✓ | | | the HR desk |
| `manageAttendance` | ✓ | ✓ | | | also gates holidays |
| `manageLeave` | ✓ | ✓ | | | approve/refuse — never one's own |
| `applyLeave` | ✓ | ✓ | ✓ | ✓ | everybody |
| `runPayroll` | ✓ | ✓ | | | set salary, prepare a month, edit payroll settings |
| `approvePayroll` | ✓ | | | | approve, reopen, mark paid, delete a draft |
| `viewPayroll` | ✓ | ✓ | | | read somebody else's pay (own payslip is always allowed) |
| `manageBilling` | ✓ | | | | raise, edit, cancel, delete a bill; billing settings; delete a receipt |
| `viewAllBilling` | ✓ | ✓ | | | read every bill and the collection position |
| `recordPayment` | ✓ | | ✓ | ✓ | record a receipt (rep: own bills only) |
| `issueSamples` | ✓ | | | | issue/adjust rep stock (reps may record their own RETURN) |
| `manageInventory` | ✓ | | | | receive stock, correct the warehouse count |
| `viewAllStock` | ✓ | ✓ | | | read stock without moving any |
| `viewSales` | ✓ | ✓ | | | read the affiliate operation — also the door to `/admin/sales` |
| `manageSales` | ✓ | | | | add a rep, issue a coupon, correct a delivery, hold the credentials |
| `processOrders` | ✓ | ✓ | | | book a parcel with the courier, print its invoice and label — spends freight, decides no commission |
| `runSalesPayout` | ✓ | ✓ | | | prepare a week's payout and adjust its lines |
| `approveSalesPayout` | ✓ | | | | approve, reopen, mark paid, delete a draft |

Note `SALES` is a **field** role (a medical representative who also bills) and has nothing to do with
the Sales CRM. An affiliate is a `SalesRep`, not a `User`, and has no login at all.

---

## 6. Data model

14 model files, 23 collections. Every schema uses `{ timestamps: true }` unless noted, and the
`models.X ?? model("X", Schema)` idiom to survive hot reload.

### 6.1 `User` — `models/User.ts`

Account **and** employment record in one document.

| Field | Type | Notes |
|---|---|---|
| `employeeId` | String | required, unique, indexed |
| `name`, `email` | String | email required + unique + indexed |
| `passwordHash` | String | required, **`select: false`** |
| `role` | enum `ROLES` | required |
| `permissions` | [String] | reserved; not currently consulted |
| `active` | Boolean | `true` — controls sign-in |
| `lastLoginAt` | Date | |
| `designation`, `department`, `workLocation` | String | |
| `joiningDate`, `confirmationDate`, `exitDate` | String | `"yyyy-mm-dd"` |
| `reportingTo` | ObjectId → User | |
| `employmentType` | enum | Full time / Part time / Contract / Intern |
| `employmentStatus` | enum `EMPLOYMENT_STATUSES` | Probation / Confirmed / Notice period / Exited — distinct from `active` |
| `exitReason` | String | |
| `phone`, `dateOfBirth`, `bloodGroup`, `address` | String | |
| `emergencyContact` | `{name, relation, phone}` | |
| `panNumber`, `uan`, `esicNumber` | String | |
| `aadhaarLastFour` | String | **only four digits are ever stored** |
| `bankAccountNo`, `bankIfsc`, `bankName` | String | |
| `leaveEntitlement` | `{Casual,Sick,Earned,Compensatory}` | absent ⇒ company default applies |
| `notes` | String | |

### 6.2 `Doctor` — `models/Doctor.ts`

| Field | Type | Notes |
|---|---|---|
| `code` | String | required, unique — `BHX-00001`, claimed through `lib/doctors/code.ts` |
| `name` | String | required, indexed |
| `specialties` | [String] | |
| `clinicName`, `phones[]`, `email`, `website` | | |
| `fullAddress`, `area`, `city`, `pinCode` | String | `area`, `city` indexed |
| `state`, `stateCode`, `gstin` | String | billing identity, captured on first invoice |
| `location` | GeoJSON Point | `coordinates: [longitude, latitude]` — **whole or absent**, see below |
| `googlePlaceId` | String | indexed, sparse — the dedupe key on import |
| `googleMapsUrl`, `rating`, `reviewCount` | | |
| `source` | enum | Google / Excel / Manual |
| `callSchedule` | `[CallWindow]` | embedded, `_id: false` |
| `callTimeVerifiedAt` | Date | |
| `priority` | enum | Hot / High / Medium / Low |
| `stage` | enum | New / Contacted / Interested / Prescribing / Not interested — indexed |
| `status` | enum | Active / Archived — indexed |
| `assignedTo` | ObjectId → User | indexed |
| `notes`, `lastVisitedAt` | | |

`CallWindow`: `{ weekday 0–6, slots: [{start "HH:MM", end "HH:MM"}], appointmentRequired, remarks, updatedBy, updatedAt }`.
Embedded because it is ≤7 tiny entries always read with the doctor, and route planning needs it on
every doctor in one query.

Indexes: `location: "2dsphere"`, `callSchedule.weekday`.

**`location` is a complete point or it is not there at all.** The 2dsphere index skips a doctor with
no location but rejects one holding half a point, *at insert time* — so `{ type: "Point" }` with no
coordinates fails the entire save with "Can't extract geo keys". `location.type` therefore has **no
schema default** (a default is written even when nothing else is), and `pre("save")` /
`pre("findOneAndUpdate")` hooks run every write through `completePoint()` (`lib/doctors/location.ts`).
A doctor typed in at the desk, or added by a rep with location switched off, has no coordinates yet
and must still save.

**Codes are claimed, not counted.** `createDoctor()` (`lib/doctors/code.ts`) reads the top of the
series and retries past a code somebody else took — `estimatedDocumentCount() + 1` hands two people
adding at the same moment the same number, and drifts from the series the first time a record goes.
Both `/api/doctors` POST and `/api/doctors/bulk` go through it; bulk carries the sequence forward so
500 rows are not 500 lookups.

### 6.3 `RoutePlan` — `models/RoutePlan.ts`

`name`, `date` (Date, indexed), `weekday` 0–6, `startTime` `"09:30"`, `visitMinutes` 45,
`stops[]`, `totalDistanceKm`, `totalTravelMinutes`, `assignedTo` → User (indexed), `createdBy`,
`status` enum Draft / Assigned / In progress / Completed.
`Stop`: `{ doctor, sequence, distanceFromPreviousKm, plannedStart, plannedEnd, withinCallTime, timingUnknown }`.
Index: `{ assignedTo: 1, date: -1 }`.

### 6.4 `Visit` — `models/Visit.ts`

`doctor` (req), `employee` (req), `routePlan`, `plannedDate` (req), `plannedStart`,
`status` enum Planned / In progress / Completed / Missed, `checkInAt`, `checkOutAt`,
`checkInLocation {latitude, longitude, accuracy}`, `outcome` enum `VISIT_OUTCOMES`,
`productsDiscussed[]`, `samples: [{product: String, quantity}]`, `interest` enum `INTEREST_LEVELS`,
`orderValue`, `notes`, `followUpDate`.
Indexes: `{employee, plannedDate:-1}`, `{doctor, plannedDate:-1}`.

Note `samples[].product` is a **string name**, matching the ledger's grouping key.

### 6.5 `VisitPhoto` — `models/VisitPhoto.ts`

`visit` (req), `doctor`, `employee` (req), `data: Buffer` (**`select: false`**), `contentType` enum
`PHOTO_TYPES`, `bytes`, `caption` (≤200), `expiresAt` (req).

**TTL index `{expiresAt: 1}, {expireAfterSeconds: 0}`** — MongoDB deletes photos 30 days after
upload with no cron job. Reading queries also filter `expiresAt: { $gt: now }` so nothing is served
in the gap between expiry and the sweep. Max 8 per visit, max 3 MB each.

### 6.6 `Product` + `AuditEvent` — `models/Catalog.ts`

`Product`: `name` (req, unique), `category`, `sampleAvailable`, `active`, `hsnCode`, `unit` (`"Pcs"`),
`price`, `mrp`, `gstRate` (18), `reorderLevel`. **No stock field** — see §4.3.

`AuditEvent`: `actor` → User, `action` (req, indexed), `entityType`, `entityId`, `metadata` (Mixed).

### 6.7 `SampleMovement` — `models/Sample.ts`

Per-representative sample ledger. `employee` (req, indexed), `product` → Product, `productName`
(req, indexed), `type` enum `MOVEMENT_TYPES` (req, indexed), `quantity` **signed** (req),
`doctor`/`visit` (DISPENSE only), `batchNo`/`expiryAt` (ISSUE only), `actor`, `occurredAt`, `notes`.
Indexes: `{employee, productName, occurredAt:-1}`, `{employee, occurredAt:-1}`.

### 6.8 `StockMovement` — `models/Inventory.ts`

Warehouse ledger. `product`, `productName` (req, indexed), `type` enum `STOCK_MOVEMENT_TYPES`
(req, indexed), `quantity` **signed** (req), `unitCost`/`batchNo`/`expiryAt`/`supplier`/`reference`
(PURCHASE, OPENING), `invoice` (SALE, SALE_RETURN), `employee` + `sampleMovement`
(SAMPLE_ISSUE, SAMPLE_RETURN), `actor`, `occurredAt`, `notes`.
Indexes: `{productName, occurredAt:-1}`, `{type, occurredAt:-1}`.

### 6.9 `Customer` — `models/Customer.ts`

Trade buyers, deliberately **separate from `Doctor`** (a stockist has no call window and no place on
a route). `code` (req, unique), `type` enum `CUSTOMER_TYPES` (default Stockist), `name` (req,
indexed), `businessName`, `contactPerson`, `phones[]`, `email`, `address`, `city` (indexed), `state`,
`stateCode` (decides CGST+SGST vs IGST), `pinCode`, `gstin`, `pan`, `drugLicenceNo`, `creditPeriod`,
`creditLimit`, `notes`, `active` (indexed). Index `{type, name}`.

### 6.10 `Invoice` — `models/Invoice.ts`

The largest document. Sub-schemas `Item`, `Payment`, `Proof`, `TaxSummary` (all `_id: false` except
`Payment`, which keeps its `_id` so a proof can point at a receipt).

**Identity** — `invoiceNo` (req, unique, indexed), `financialYear` (req, indexed),
`taxed` (true = Tax Invoice with GST, false = Bill of Supply).

**Party** — at most one of `doctor` / `customer` is set; a one-off sale sets neither and lives
entirely in `billTo`. `partySource` enum Doctor / Customer / One-off. `partyType` — the buyer kind as
free text ("Doctor", "Stockist", …), indexed for cross-directory filters.
`employee` → User, **required** — every bill belongs to a representative.

**Snapshot** — `billTo { name, clinicName, address, city, state, stateCode, pinCode, gstin, phone, type }`.
Note `type` is spelled `{ type: String }`: a bare `String` on a key called `type` would make Mongoose
read the whole of `billTo` as a string field.

**Tax** — `placeOfSupply {state, code}`, `interState`, `ratesIncludeTax`.

**Lines** — `items[]`: `product`, `name` (req), `hsnCode`, `unit`, `quantity`, `freeQuantity`,
`rate`, `discountType` PERCENT|AMOUNT, `discountValue`, `gstRate`, then the server-computed
`gross`, `discount`, `taxableValue`, `cgst`, `sgst`, `igst`, `taxAmount`, `total`.

`freeQuantity` is **scheme goods** — the "+1" of a 10+1. It changes **no figure on the invoice**:
every total is about what was charged for. What it does change is stock, because free goods come off
the same shelf — `unitsSupplied()` (`lib/billing/gst.ts`) adds the two together and is the only way
`syncInvoiceStock` and the bill form's shortage warning count units. The printed sheet grows a Free
column, and a line in words under the totals, **only when a bill actually carries a scheme**.
`taxSummary[]`: `{hsnCode, gstRate, taxableValue, cgst, sgst, igst}` — the rate-wise block a GST
invoice must print.

**Totals** — `subtotal`, `totalDiscount`, `taxableValue`, `cgstTotal`, `sgstTotal`, `igstTotal`,
`taxTotal`, `roundOff`, `grandTotal`.

**Money in** — `payments[]`: `amount` (≥0.01), `mode` enum `PAYMENT_MODES`, `reference`, `paidAt`,
`receivedBy` → User, `recordedBy` → User, `notes`, `proof?` (metadata only — bytes live in
`PaymentProof`). Cached: `amountPaid`, `balanceDue`, `status` enum `INVOICE_STATUSES`.

**Dates** — `invoiceDate` (req, indexed), `dueDate` (indexed), `paymentTerms` (days),
`followUps[]`: `{date (req), note, doneAt, createdBy}` — every chase agreed on the bill, because
collection is a conversation and one date could only ever hold the last thing said. Cached:
`followUpDate` (indexed) = the earliest entry with no `doneAt`.

**Trail** — `notes`, `terms`, `createdBy`, `updatedBy`, `cancelledAt`, `cancelledBy`, `cancelReason`.

Indexes: `{employee, invoiceDate:-1}`, `{doctor, invoiceDate:-1}`, `{status, dueDate}`.

### 6.11 `PaymentProof` — `models/PaymentProof.ts`

`invoice` (req, indexed), `payment` (the payment sub-document `_id`; req, **unique** — one file per
receipt), `data: Buffer` (**`select: false`**), `contentType` enum `PROOF_TYPES` (jpeg/png/webp/pdf),
`bytes`, `fileName` (≤200), `uploadedBy` (req). **No TTL** — unlike a visit photo, this is the answer
to "the doctor says they paid in March" years later.

### 6.12 `BillingSettings` + `Counter` — `models/Settings.ts`

`BillingSettings` (`key: "billing"`, singleton): seller identity (`legalName`, `tradeName`, address,
`state`, `stateCode`, `gstin`, `pan`, contact, `drugLicenceNo`), bank block
(`bankName`, `bankAccountName`, `bankAccountNo`, `bankIfsc`, `bankBranch`, `upiId`),
QR block (`paymentQr: Buffer` **`select: false`**, `paymentQrType`, `paymentQrBytes`,
`paymentQrUpdatedAt`, `paymentQrLabel`), and defaults (`invoicePrefix` `"BHX"`,
`defaultPaymentTerms`, `defaultGstRate` 18, `ratesIncludeTax`, `terms`, `signatoryName`,
`showReceiverSignature` (default **true**) + `receiverSignatureLabel` for the space the person taking
delivery signs).

`Counter`: `{ key (unique), value }`. Invoice numbers are claimed with an **atomic `$inc` inside
`findOneAndUpdate`**, keyed `invoice:<SERIES>:<FY>` — never a read-then-write.

### 6.13 Payroll — `models/Payroll.ts`

**`SalaryStructure`** — effective-dated, never edited in place. `employee` (req, indexed),
`effectiveFrom` `"yyyy-mm"` (req), `basic` (req), `hra`, `conveyance`, `medical`, `special`,
`otherAllowances[{name, amount}]`, `pfApplicable`, `pfOnFullBasic`, `esiApplicable`,
`professionalTaxApplicable`, `monthlyTds`, `recurringDeductions[]`, `note`, `createdBy`.
**Unique index `{employee, effectiveFrom}`** — revising the same month corrects that revision.

**`PayrollRun`** — `month` `"yyyy-mm"` (req, unique), `status` Draft / Approved / Paid, `lopBasis`
(frozen), `totals {employees, gross, deductions, netPay, employerCost}`,
`skipped[{employee, name, employeeId, reason}]` (nobody is left out quietly), plus
`generatedBy/At`, `approvedBy/At`, `paidBy/At`, `paymentDate`, `paymentMode`, `reference`, `note`.

**`Payslip`** — `run`, `month`, `employee`, `status`, `snapshot{…}` (§4.5), `daysInMonth`,
`divisorDays`, `onRollDays`, `lopDays`, `paidDays`, `earnings[]`, `gross`, `deductions[]`,
`totalDeductions`, `employerContributions[]`, `costToCompany`, `netPayable`, `netPay`, `roundOff`,
`pfWages`, `esiWages`, `fullGross`, `note`.
**Unique index `{month, employee}`**; also `{employee, month:-1}`.

**`PayrollSettings`** (`key: "payroll"`, singleton) — `lopBasis`, `ptSlabs[{upTo, amount}]`,
`ptStateName` ("Karnataka"), `ptFebruaryAmount`, `payDay` (7), `defaultPayMode`, `signatoryName`,
`payslipNote`.

### 6.15 Affiliate sales — `models/Sales.ts`

Five collections. Deliberately a separate world from `User` and `Invoice`: an affiliate is not an
employee (no attendance, no payslip, no salary structure) and a Shopify order is not a GST invoice
this company raised. Modelling either as the other would have meant a dozen always-empty fields and a
permission table that no longer said what it meant.

**`SalesRep`** — `code` (req, unique, upper — "RAUSHAN"), `name` (req, indexed), `phone`, `email`,
`coupons[{code, suffix, active, note}]`, `user?` → User (reserved for rep logins),
`payMethod` enum `PAYOUT_MODES`, `upiId`, `bankName`, `bankAccountName`, `bankAccountNo`, `bankIfsc`,
`panNumber`, `active` (indexed), `joinedAt`, `notes`, `createdBy`.
**Unique index `{"coupons.code"}`** — two reps sharing a code would make every order it brought in
unattributable, with no way to work out afterwards whose it was. A withdrawn coupon is switched off,
never removed: orders already attributed still point at it.

**`SalesOrder`** — `source` enum `ORDER_SOURCES`, `shopifyOrderId` (unique, sparse), `name` ("#1042"),
`orderNumber`, `placedAt` (req, indexed), `currency`, `customer{…}`, `couponCode` (indexed),
`rep` → SalesRep (indexed), `ruleSuffix`, `discountCodes[]`,
`items[{productId, variantId, sku, title, quantity, gross, couponDiscount, otherDiscount, refunded}]`,
`totals{gross, discount, refunded, paid}`, `financialStatus`, `paymentMethod`, `cancelledAt`,
`fullyRefunded`,
`shipment{` — read back by the delivery sync: `shiprocketOrderId, shipmentId, awb, courier, status,
statusCode, deliveredAt, checkedAt`; written when the parcel is booked from here (§7.9a):
`pickupLocation, courierId, parcel{weight,length,breadth,height}, codAmount, pickupScheduledAt,
pickupToken, processedAt, processedBy, lastError` `}`,
`delivery{reported, override, overrideReason, overrideBy, overrideAt, state, at}`,
`commission{rate, base, amount, status, maturesAt, wholeOrderFallback, reason, needsReversal, payout, computedAt}`,
`syncedAt`, `notes`.

Every line figure is the **whole-line** rupee amount, not the unit — that is how Shopify reports
discounts, and converting back and forth is how a rounding error gets into somebody's commission.
`delivery.state` is a cache of `override ?? reported`; `commission` is a cache of the pure arithmetic
(§4.13a). Indexes: `{rep, placedAt:-1}`, `{"commission.status", "commission.maturesAt"}`,
`{"delivery.state", placedAt:-1}`, `{"shipment.awb", placedAt:-1}` (the picking list: what has not
been sent to the courier yet, oldest first).

**The two halves of `shipment` must not be written over each other.** The delivery sync sets each
read-back field on its own path rather than assigning the object, because replacing it wholesale
would erase the booking half — and because `update.awb` is absent for an order Shiprocket has
accepted but not yet acknowledged an airway bill for. A blind overwrite there blanks an AWB this
system just assigned, the order reads as unprocessed, somebody books it again, and one customer
receives two parcels.

`customer` carries the full shipping address — `address1, address2, city, state, pinCode, country` —
because a courier booking is refused without one. `mergeCustomer` (§ `lib/sales/shopify.ts`) keeps a
field the shop stops sending, so an address typed in to get a parcel booked survives the next sync.

**Only attributed orders are stored.** The sync skips an order carrying no rep's coupon and reports
how many it skipped, so the collection is the affiliate operation rather than a copy of the shop.

**`SalesPayout`** — `payoutNo` (req, unique — `PO/2026-27/0004`), `financialYear`, `from`, `to`
(`"yyyy-mm-dd"`), `status` enum `PAYOUT_STATUSES`, `holdDays` (**frozen** onto the run),
`totals{reps, orders, gross, net}`, plus `generatedBy/At`, `approvedBy/At`, `paidBy/At`,
`paymentDate`, `paymentMode`, `reference`, `note`.

**`SalesPayoutLine`** — `run`, `rep`, `snapshot{name, code, phone, payMethod, upiId, bankName,
bankAccountLastFour, panNumber}`, `orders[{order, name, placedAt, deliveredAt, base, rate, amount}]`,
`orderCount`, `gross`, `adjustments[{name, amount}]` (**signed**), `net`, `note`.
**Unique index `{run, rep}`.** The orders are copied on rather than joined at read time (§4.5): a rep
asking in November what August's ₹1,800 was made of is owed the four orders exactly as they stood.

**`SalesLead`** — a business somebody found and decided was worth approaching, before it is anybody's
customer or affiliate. `name` (req, indexed), **`type`** (req, indexed — free text, the label the
search filed it under), `status` enum `LEAD_STATUSES` (New / Contacted / Interested / Not interested,
indexed), `phone`, `website`, `address`, `area`, `city` (indexed), `googlePlaceId` (**unique,
sparse**), `googleMapsUrl`, `rating`, `reviewCount`, `latitude`, `longitude`, `searchQuery`,
`searchLocation`, `source` enum `LEAD_SOURCES` (Google / Manual), `notes`, `createdBy`, `updatedBy`.
Indexes: `{type, name}`, `{status, createdAt:-1}`.

`type` is **required and free text**, not an enum. It is the only thing that makes a saved lead
findable once the search that produced it is forgotten, and an enum would mean a deployment every
time somebody sweeps a trade nobody thought of. `LEAD_TYPE_SUGGESTIONS` populates a `<datalist>`;
nothing enforces it.

Coordinates are **plain numbers, not a GeoJSON point** — nothing routes a lead, so the 2dsphere index
and the half-a-point save failure that comes with it (§6.2) would be a trap kept for no gain. For the
same reason a place with no coordinates is still saved, where `toDiscovered` drops one.

The place id is what makes a second sweep of an area an update rather than a duplicate. A re-sweep
overwrites what Google knows (name, phone, rating) and **never** what a person knows: `status`,
`notes` and a corrected `type` are `$setOnInsert` only. A lead is deleted outright rather than
archived (§4.10) because nothing anywhere references one.

**`SalesSettings`** (`key: "sales"`, singleton) — `shopifyDomain`, `shopifyAccessToken`
(**`select: false`**, encrypted), `shopifyApiVersion`, `shopifyConnectedAt`, `lastOrderSyncAt/Error`,
`shiprocketEmail`, `shiprocketPassword` + `shiprocketToken` (**`select: false`**, encrypted),
`shiprocketTokenExpiresAt`, `lastShipmentSyncAt/Error`, `rules[{suffix, label, rate, base, products,
active}]`, `holdDays` (7), `payoutWeekday` (1), `backfillDays` (90), `currency`.

The two credentials are encrypted at rest by `lib/sales/secrets.ts` (AES-256-GCM, key derived from
`AUTH_SECRET`). Neither can be hashed — both must be *presented* to somebody else's API — and a
Shopify admin token reads every order and customer the company has, so a database dump should not
hand it over in plain sight. **Rotating `AUTH_SECRET` makes them unreadable**, which is correct: they
are re-entered on the settings screen.

### 6.14 HR — `models/HR.ts`

**`LeaveRequest`** — `employee` (req, indexed), `type` enum `LEAVE_TYPES` (req), `fromDate`, `toDate`
(strings, req), `halfDay` enum (single-day requests only), `days` (**computed on the server**),
`leaveYear` (req, indexed), `reason` (req), `contactNumber`, `status` enum `LEAVE_STATUSES`
(indexed), `decidedBy`, `decidedAt`, `decisionNote`.
Indexes: `{employee, fromDate:-1}`, `{status, fromDate:-1}`.

**`Attendance`** — `employee` (req), `date` string (req), `status` enum `ATTENDANCE_STATUSES` (req),
`source` enum Auto / Manual / Leave, `note`, `markedBy`.
**Unique index `{employee, date}`** — marking a day twice is an update, not a duplicate.
Only *exceptional* days are stored; the rest are inferred (§8.4).

**`Holiday`** — `date` (req, unique), `name` (req), `note`, `createdBy`. One row per date, company-wide.

---

## 7. API reference

All routes live under `src/app/api/`. Shared helpers in `lib/api.ts`:

| Helper | Behaviour |
|---|---|
| `ok(data, status=200)` | `{ data }` |
| `badRequest(message, status=400)` | `{ error }` |
| `fail(error)` | ZodError → 400 with `"field: message"`; duplicate key → 409; otherwise logs and returns 500 `"Something went wrong. Please try again."` |
| `pageParams(url)` | `{ page≥1, limit≤100 (default 20), skip, q }` |
| `OBJECT_ID` | `/^[a-f\d]{24}$/i` |

Every handler is `try { … } catch (error) { return fail(error) }`.
Responses are `{ data: … }` on success and `{ error: "…" }` on failure.

### 7.1 Auth

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/auth/login` | POST | public | `{identifier, password}` — identifier matches `email` (lower-cased) **or** `employeeId`, and the account must be `active`. One message for both "no such account" and "wrong password", so the form never reveals which accounts exist. Sets the cookie `httpOnly, sameSite: lax, secure in production, path /, maxAge 12h` and stamps `lastLoginAt` |
| `/api/auth/logout` | POST | public | clears the cookie |
| `/api/auth/me` | GET | session | current session |
| `/api/auth/change-password` | POST | session | `{currentPassword, newPassword ≥8}` |

### 7.2 Doctors

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/doctors` | GET | session | paginated (`q` from `pageParams`); filters `location`, `city`, `specialty`, `priority`, `weekday`, `routable=1` (has coordinates), `missingCallTime=1`, `mine=1`. Clauses needing their own `$or` are collected into `$and` so they cannot overwrite each other |
| | POST | `addDoctors` | `{name, specialties[], clinicName, phones[], email, fullAddress, area, city, latitude, longitude, priority, stage, callSchedule, notes}`; audits `doctor.created` |
| `/api/doctors/[id]` | GET | session | |
| | PATCH | `manageDoctors` | partial update incl. `assignedTo`, `gstin`, `stateCode`, coordinates |
| | DELETE | `manageDoctors` | archives |
| `/api/doctors/[id]/call-schedule` | PUT | `updateCallTime` | `{callSchedule}` validated by `callScheduleSchema`; audits `doctor.call-schedule.updated` |
| `/api/doctors/locations` | GET | session | `{name, total, missingCallTime}[]` for the location filter |
| `/api/doctors/export` | GET | `manageDoctors` | XLSX of the directory |
| `/api/doctors/bulk` | POST | `addDoctors` | `{doctors: [≤500]}`; upserts on `googlePlaceId`, else `{name, fullAddress}`; **never overwrites an existing call schedule**; auto-assigns `BHX-#####` codes |
| `/api/google/doctors` | POST | `manageDoctors` | wide-radius Places search (`discoverySchema`) |
| `/api/google/lookup` | POST | `addDoctors` | single-place lookup for the rep's add-doctor screen (`lookupSchema`) |

### 7.3 Route plans and visits

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/plans` | GET | session | reps see their own |
| | POST | `planRoutes`, or `planOwnRoute` when assigning to self | `planInputSchema` + `{name, assignedTo?}`; creates the plan **and** its `Visit` rows |
| `/api/plans/preview` | POST | `planRoutes` ∪ `planOwnRoute` | orders without saving |
| `/api/plans/[id]` | GET | session | |
| | PUT | `planRoutes` | rebuild: `planInputSchema` + `{name, assignedTo?}` |
| | PATCH | `planRoutes` | `{assignedTo?, status?}` |
| | DELETE | `planRoutes` | completed visits kept; pending visits deleted with the plan |
| `/api/visits` | GET | session | reps forced to own; filters `employee`, `doctor`, `status`, `from`, `to` |
| `/api/visits/[id]` | PATCH | session + ownership | discriminated union on `action`: `check-in` / `complete` / `missed` — see §8.5 |
| `/api/visits/[id]/photos` | GET | session + ownership | metadata only, unexpired |
| | POST | field panel + own visit + checked in | `multipart/form-data`, field `photo` (repeatable) + `caption`; ≤8 per visit, ≤3 MB each, jpeg/png/webp; all files validated before any is written |
| `/api/visits/[id]/photos/[photoId]` | GET | session + reach check | serves the bytes |
| | DELETE | session + ownership | audits `visit.photo.deleted` |

`planInputSchema` (`lib/plans.ts`): `{date "yyyy-mm-dd", referenceDoctorId, doctorIds[2..40], startTime "HH:MM" = "09:30", visitMinutes 10..180 = 45}`.
Rejects a reference doctor not in the list, unknown doctors, and doctors without coordinates.

### 7.4 Samples and inventory

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/samples/stock` | GET | own, or `viewAllStock` for others | per-product `{issued, dispensed, returned, adjusted, balance}` |
| `/api/samples/movements` | GET | own; `viewAllStock` for others | filters `employee`, `type`, `product` |
| | POST | `issueSamples`; a rep may post **only** `RETURN` for themselves | `{type: ISSUE|RETURN|ADJUSTMENT, employee, occurredAt?, notes?, lines:[{product, quantity≠0, batchNo?, expiryAt?}]}`. `DISPENSE` is absent on purpose — it is written from the visit log. Mirrors ISSUE/RETURN into the warehouse ledger |
| `/api/inventory/stock` | GET | `viewAllStock` | `stockLevels()` across the whole catalogue |
| `/api/inventory/movements` | GET | `viewAllStock` | |
| | POST | `manageInventory` | `{type: PURCHASE|OPENING|SALE_RETURN|ADJUSTMENT, occurredAt?, supplier?, reference?, notes?, lines:[{product, quantity≠0, unitCost?, batchNo?, expiryAt?}]}`. `SALE` and the `SAMPLE_*` types are absent — written by the invoice and the sample ledger |
| `/api/products` | GET | session | `?all=1` includes retired; stock levels included for `viewAllStock` |
| | POST | `manageDoctors` | `{name, category?, sampleAvailable, hsnCode?, unit?, price?, mrp?, gstRate?, reorderLevel?, stock?}` — `stock` writes a ledger row, not a column |
| `/api/products/[id]` | PATCH | `manageDoctors` | same fields + `active`; a rename calls `renameProductInLedgers` |
| | DELETE | `manageDoctors` | deletes if unused, otherwise retires |

### 7.5 Billing

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/invoices` | GET | session | Reps are **forced** to `employee = self`; desk roles need `viewAllBilling`. Filters: `q` (invoiceNo / billTo.name / clinicName), `employee`, `doctor`, `customer`, `partyType`, `status`, `from`, `to`, `due=1`, `overdue=1`. Returns `{items, total, page, pages, summary{billed, collected, outstanding}}` — the summary covers the whole filtered set, excluding cancelled |
| | POST | `manageBilling` | `billInputSchema` → `composeBill()`. Refuses a tax invoice without a seller GSTIN or state code. The `employee` must be an active MR/SALES. Claims a number atomically, `recalculate()`, save, then `syncInvoiceStock()`. Optional `payment` records money taken at the counter (capped at `grandTotal`) |
| `/api/invoices/[id]` | GET | session; rep must own it, desk needs `viewAllBilling` | fully populated |
| | PUT | `manageBilling` | rewrite via the same `composeBill`. Refused once **cancelled**, and refused when the new `grandTotal` would fall more than ₹0.50 below `amountPaid` — a part-paid bill is otherwise freely correctable and its receipts are untouched (`composed.fields` carries none). Keeps `invoiceNo`, `financialYear`, sets `updatedBy`, re-syncs stock |
| | PATCH | `manageBilling` | `{dueDate?, followUps?, followUpDate?, notes?, terms?, cancel?, cancelReason?}`. `followUps` replaces the list and wins over `followUpDate`, which moves the earliest outstanding chase (or, `null`, drops every outstanding one). Cancelling is refused if money has been received; a cancelled invoice writes no stock rows, which returns the goods |
| | DELETE | `manageBilling` | only with no payments; also deletes its `StockMovement`s and any `PaymentProof`s |
| `/api/invoices/[id]/payments` | POST | `recordPayment` + ownership for reps | `{amount>0, mode, reference?, paidAt?, notes?}`. Refused when cancelled or already Paid, or when the amount exceeds `balanceDue + 0.5`. `receivedBy` = the rep (field) or the bill's owner (admin). Returns `{status, amountPaid, balanceDue, payments, payment: <new receipt id>}` |
| | DELETE `?payment=<id>` | `manageBilling` | removes the receipt **and** its `PaymentProof` |
| `/api/invoices/[id]/follow-ups` | POST | `recordPayment` + ownership for reps | `{date, note?, moveDueDate?}` appends one chase. Refused on a cancelled bill, past 20 follow-ups, or when a non-`manageBilling` caller asks to move the due date. Deliberately not part of the invoice PATCH: the rep hears "come back after the 15th" and may write it down, but may not rewrite a bill |
| | PATCH `?followUp=<id>` | as above | `{date?, note?, done?}` — reschedules, or marks the call made. Marking one made twice does not move the day it was made on |
| | DELETE `?followUp=<id>` | as above | drops a chase agreed by mistake; no figure on the bill moves |
| `/api/invoices/[id]/payments/[paymentId]/proof` | GET | session + reach check | serves the bytes |
| | POST | `recordPayment` (+ ownership) | one file per receipt, ≤5 MB, jpeg/png/webp/pdf; audits `invoice.payment.proof.added` |
| | DELETE | `recordPayment` (+ ownership) | audits `invoice.payment.proof.removed` |
| `/api/customers` | GET | `viewAllBilling` | paginated, `q`, `type` |
| | POST | `manageBilling` | `customerSchema` |
| `/api/customers/[id]` | GET | `viewAllBilling` | |
| | PATCH | `manageBilling` | |
| | DELETE | `manageBilling` | |
| `/api/billing/settings` | GET | session | seller details (no QR bytes) |
| | PUT | `manageBilling` | full settings schema; GSTIN may be blank but not malformed |
| `/api/billing/settings/qr` | GET | session | the QR image bytes |
| | POST | `manageBilling` | image only, ≤1 MB; audits `billing.qr.updated` |
| | DELETE | `manageBilling` | audits `billing.qr.removed` |

`billInputSchema` (`lib/billing/compose.ts`):

```ts
{
  partySource: "Doctor" | "Customer" | "One-off" = "Doctor",
  doctor?: ObjectId, customer?: ObjectId,     // exactly one, or neither for One-off
  employee: ObjectId,                          // required — the rep the bill belongs to
  taxed = true, ratesIncludeTax = false,
  invoiceDate: "yyyy-mm-dd", dueDate?, paymentTerms 0..365 = 0,
  followUps?: [{ _id?, date: "yyyy-mm-dd", note?≤200, done? }]≤20,   // omitted on PUT = leave them alone
  followUpDate?,                                                     // the one-date form, folded into the list
  placeOfSupplyCode?: <state code>,
  billTo?: { name?, clinicName?, type?, gstin?, address?, city?, pinCode?, phone? },
  saveDoctorDetails = true,
  items: [{ product?, name, hsnCode?, unit?, quantity>0, freeQuantity: int ≥0 = 0, rate≥0,
            discountType: "PERCENT"|"AMOUNT" = "PERCENT", discountValue ≥0 = 0, gstRate 0..50 = 0 }]≥1,
  notes?, terms?,
  payment?: { amount>0, mode, reference?, paidAt? }
}
```

Every line's `name` must exist in the product catalogue — what is billed and what leaves the
warehouse are counted under the same name.

### 7.6 HR

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/hr/overview` | GET | `viewHr` | headcount, who is off today, pending decisions |
| `/api/hr/attendance` | GET | session | reps and anyone without `manageAttendance` get their own month |
| | POST | `manageAttendance` | `{employee, date, status, note?}` — upsert on `{employee, date}` |
| | DELETE | `manageAttendance` | clears a manual mark |
| `/api/hr/holidays` | GET | session | `?year=` |
| | POST | `manageAttendance` | `{date, name, note?}` |
| | DELETE `?date=` | `manageAttendance` | |
| `/api/hr/leave` | GET | session | own by default; `manageLeave` sees everybody |
| | POST | `applyLeave` | `{employee?, type, fromDate, toDate, halfDay?, reason, contactNumber?}`. `employee` honoured only for `manageLeave`. `days` is computed server-side. Refused when: end before start, zero days, **more than 90 days**, employee deactivated, an existing request **overlaps** the range, or `days > balance.available` for that leave type |
| `/api/hr/leave/[id]` | PATCH | owner (cancel) or `manageLeave` (approve/reject) | **nobody decides their own** |
| | DELETE | owner or `manageLeave` | |

### 7.7 Payroll

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/hr/salary/[id]` | GET | own, or `viewPayroll` | revisions + `mayEdit` |
| | POST | `runPayroll` | one revision: `{effectiveFrom "yyyy-mm", basic, hra, conveyance, medical, special, otherAllowances[≤12], pfApplicable, pfOnFullBasic, esiApplicable, professionalTaxApplicable, monthlyTds, recurringDeductions[≤12], note?}`; audits `salary.revised` |
| | DELETE `?effectiveFrom=` | `runPayroll` | audits `salary.revision.deleted` |
| `/api/hr/payroll` | GET | `viewPayroll` | runs + `mayRun` / `mayApprove` |
| | POST | `runPayroll` | `{month "yyyy-mm", action: "preview" \| "generate"}`. **Preview writes nothing.** Generate calls `saveDraftRun()`; audits `payroll.generated` |
| `/api/hr/payroll/[id]` | GET | `viewPayroll` | run + payslips + capability flags |
| | PATCH | `approvePayroll` | `{action: "approve"}` \| `{action: "reopen"}` \| `{action:"pay", paymentDate, paymentMode, reference?}`. Reopen is allowed only from Approved — a **Paid** month can never be reopened. Audits `payroll.approved` / `payroll.reopened` / `payroll.paid` |
| | DELETE | `approvePayroll` | drafts only; audits `payroll.deleted` |
| `/api/hr/payroll/settings` | GET | `viewPayroll` | |
| | PUT | `runPayroll` | `{lopBasis, ptStateName?, ptSlabs[≤12], ptFebruaryAmount?, payDay 1..31, defaultPayMode?, signatoryName?, payslipNote?}`; audits `payroll.settings.updated` |
| `/api/hr/payslips` | GET | own, or `viewPayroll` | **own view is limited to Approved/Paid months** |

### 7.8 Team and reports

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/team` | GET | session | list |
| | POST | `manageEmployees` | `{name, employeeId, email, password ≥8, role, designation?, department?, joiningDate?, phone?}` |
| `/api/team/[id]` | GET | `manageEmployees`, or self | |
| | PATCH | `manageEmployees` | the whole employment record + `newPassword?` + `leaveEntitlement?` |
| | DELETE | `manageEmployees` | refused for anyone with visits, and for the last administrator |
| `/api/reports` | GET | `viewAllReports` | `?from=&to=` (default last 30 days). One pass returning totals, per-employee `{planned, completed, samples, orderValue}`, outcome counts, sample distribution by product with distinct doctor count, interest split, and sample movement totals |

### 7.9 Affiliate sales

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/sales/overview` | GET | `viewSales` | `?from=&to=` (default last 30 days). Totals, delivery rate, earnings by commission status, top five reps, next payout date, proposed period, connection state and the last sync error |
| `/api/sales/leads/search` | POST | `manageSales` | `{query, location, type, resultLimit}`. One Google Places text search, biased to the geocoded location. **Writes nothing** — searching is billed and saving is a second, deliberate step. Repeats inside 10 minutes are answered from an in-process cache. `manageSales` rather than `viewSales` because this spends quota |
| `/api/sales/leads` | GET | `viewSales` | paginated; filters `q` (name/phone/address/area/city), `type`, `city`, `status`. `counts` are taken **before** the status filter, so the status labels show real numbers; `types` is every trade ever saved |
| | POST | `manageSales` | `{leads[], searchQuery?, searchLocation?}`. Upserts on `googlePlaceId`, returning `{created, updated}`. Audits `sales.leads.saved` |
| `/api/sales/leads/[id]` | PATCH | `manageSales` | `{status?, type?, phone?, notes?}`. Audits `sales.lead.updated` |
| | DELETE | `manageSales` | removes it outright. Audits `sales.lead.deleted` |
| `/api/sales/reps` | GET | `viewSales` | `{reps, summaries}`; `?active=1` |
| | POST | `manageSales` | `{name, code, phone?, email?, coupons?, payMethod, upiId?, bank…, panNumber?, joinedAt?, notes?}`. Coupons omitted are built from the active rules (`couponsFor`), so a rep gets one code per rule. Refuses a code already held by anybody, and any coupon that does not split back into a name and digits. Audits `sales.rep.created` |
| `/api/sales/reps/[id]` | GET | `viewSales` | rep + summary + last 200 orders |
| | PATCH | `manageSales` | the record, and `coupons` (a code dropped from the list is switched off, never removed). The rep `code` itself is fixed once issued |
| | DELETE | `manageSales` | deactivates where orders reference them, deletes outright otherwise (§4.10) |
| `/api/sales/orders` | GET | `viewSales` | paginated; filters `q` (order/coupon/customer), `rep`, `coupon`, `delivery`, `status`, `attention=1`, `from`, `to`, and for the picking list `processed` (`no` \| `booked` \| `yes` \| `failed`), `payment` (`COD` \| `Prepaid`), `courier`, `source`, `sort=oldest`. `summary` covers the whole filtered set; `couriers` is every courier ever used, unfiltered, so narrowing the list cannot empty the dropdown that widens it again |
| `/api/sales/orders/[id]` | GET | `viewSales` | |
| | PATCH | `manageSales` | `{override?: DeliveryState \| null, overrideReason?, notes?}` — the manual delivery correction. Recalculates and audits `sales.delivery.overridden` |
| `/api/sales/fulfilment/options` | GET | `processOrders` | The account's pickup addresses and the last parcel's measurements. A missing or refused Shiprocket credential is a **200 with a `refusal` sentence**, not an error — the list and its filters still work without one |
| `/api/sales/fulfilment/couriers` | POST | `processOrders` | `{orderId, pickupLocation, weight, pinCode?}` → the couriers that reach that pin code, with rates. Per order, because the answer is per pin code; a batch sends a rule instead |
| `/api/sales/orders/process` | POST | `processOrders` | `{orderIds[≤5], pickupLocation, parcel{}, courierId? \| courierRule, schedulePickup, address?}`. Books each order and returns a `ProcessResult` **per order**, never a total. `maxDuration = 60`. Not a transaction and deliberately so — an order booked at the courier stays booked here. Audits `sales.orders.processed` |
| `/api/sales/orders/documents` | GET | `processOrders` | `?ids=&doc=invoice\|label` (≤30). One merged PDF, streamed through rather than redirected — the Shiprocket URL is signed and expires. An invoice keys on the **order**, a label on the **shipment**; orders not ready are named and counted in `x-orders-skipped` |
| `/api/sales/sync` | POST | `manageSales` | `{target: "all" \| "orders" \| "shipments" \| "recalculate", sinceDays?}`. Runs inline and returns a `SyncReport`. An integration failure is a **502 carrying the other side's own words** |
| `/api/sales/cron` | GET | `CRON_SECRET` bearer, **or** `manageSales` | The nightly pass: sync, then re-price everything open. A failed pull still re-prices, because maturity does not depend on Shopify answering |
| `/api/sales/settings` | GET | `viewSales` | Credentials are never sent back — only `shopifyTokenSet` / `shiprocketPasswordSet` and a masked hint |
| | PUT | `manageSales` | Blank secrets leave what is stored alone. A changed rate or hold period **re-prices every unclaimed commission immediately** and reports how many; a changed Shiprocket credential drops the cached token |
| `/api/sales/settings/test` | POST | `manageSales` | `{service: "shopify" \| "shiprocket"}`. A *failed credential* is a 200 with `{ok: false, message}` — the request was fine, the answer is no |
| `/api/sales/shopify/install` | GET | `manageSales` | **Redirects** to Shopify's approval screen. Mints the `state` nonce into an http-only cookie |
| `/api/sales/shopify/callback` | GET | `manageSales` | Checks the nonce (constant-time), the HMAC and the shop domain, then exchanges the code for an offline token and stores it encrypted. Always ends back on the settings screen with a message, never a bare error page |
| `/api/sales/payouts` | GET | `viewSales` | runs + the `proposed` next period + `mayRun` / `mayApprove` |
| | POST | `runSalesPayout` | `{action: "preview" \| "generate", from?, to?}`. **Preview writes nothing.** Generate refuses while another draft is open, so the same commissions cannot be split across two runs |
| `/api/sales/payouts/[id]` | GET | `viewSales` | run + lines + capability flags |
| | PATCH | `runSalesPayout` (adjust) / `approveSalesPayout` (the rest) | `{action:"adjust", line, adjustments[], note?}` (draft only) \| `{action:"approve"}` \| `{action:"reopen"}` \| `{action:"pay", paymentDate, paymentMode, reference?}`. Reopen only from Approved; **Paid is terminal** |
| | DELETE | `approveSalesPayout` | drafts only; releases and re-prices the commissions |

### 7.9a Processing an order — `lib/sales/{fulfilment,booking}.ts`

Booking the parcel, which was until now done by hand in Shiprocket's own panel: find the order, type
it in again, check which couriers reach that pin code, assign an airway bill, print the invoice.
Forty times a morning, in a system that had never heard of the coupon that brought the order in.

`lib/sales/fulfilment.ts` is **pure and tested** — the parcel's value, the payment mode, the ten
digits of a phone number, the booking body, and which courier a rule picks. `lib/sales/booking.ts`
is the four calls in order, and `/admin/sales/orders/process` is the screen.

Four things about it are decisions rather than plumbing:

1. **Find before create.** A shop connected to Shiprocket as a channel pushes its own orders across,
   so the order about to be booked may already be sitting there half-finished. Every form the order
   could be filed under (`matchKeysFor`, §8.8) is tried first. Creating a duplicate would either be
   refused for a duplicate id or — worse — accepted: two parcels, two freights, one customer.
2. **Booked under the shop's own order name.** `order_id` is `#1042`, not this database's id, because
   `channel_order_id` is the key the delivery sync joins back on. Booking under anything else creates
   a parcel this CRM can never find again, and a rep whose order was delivered would never be paid.
3. **A failure is a result, not an exception.** Every order in a batch comes back as a row with its
   reason, and the reason is written to `shipment.lastError` as well — a batch is read after lunch,
   not watched. The ids are saved the moment the booking exists, *before* the airway bill is asked
   for, so a wallet that runs out leaves the honest state (in Shiprocket, no AWB) rather than an
   order that looks untouched here and exists over there.
4. **Nothing here touches commission.** Booking freight decides no money: the delivery state stays
   whatever the courier last said, and the commission follows it exactly as before (§4.4). That is
   also why the guard is `processOrders` (ADMIN + HR) rather than `manageSales` — the desk that packs
   the boxes should not need the authority to redirect somebody's commission.

A named courier is never substituted; an order it cannot serve is reported. A rule (`recommended`,
`cheapest`, `fastest`) is applied per order against that order's own serviceability list, which is
what makes one press work for forty parcels bound for forty pin codes.

---

## 8. Business logic

### 8.1 GST and invoice arithmetic — `lib/billing/gst.ts` (pure, tested)

```
money(v)                      → 2dp, halves up, with a 1e-9 nudge (1.005*100 is 100.4999… in binary)
computeLine(line, options)    → one priced line
computeInvoice(lines, opts)   → { lines, totals } including the HSN×rate summary
balanceOf(total, payments)    amountPaidOf(payments)
statusFor(total, paid, cancelled) → Cancelled | Unpaid | Partially paid | Paid
isOverdue(invoice, now)       derived at read time, compares end-of-day
amountInWords(amount)         Indian grouping — crore, lakh, thousand
```

Line rules, in order:

1. `gross = quantity × rate`.
2. Discount comes off **before** tax — a discount on the face of an invoice reduces the taxable
   value. It can wipe a line out but never turn it into a credit.
3. `taxed: false` (Bill of Supply) forces `gstRate = 0`.
4. `ratesIncludeTax` ⇒ `taxableValue = net / (1 + rate/100)`; otherwise `taxableValue = net`.
5. `interState` ⇒ one `igst`; otherwise `cgst = money(tax/2)` and **`sgst = money(tax - cgst)`** —
   halved by subtraction so the two always add back to the line's tax.
6. `grandTotal = Math.round(netTotal)`; `roundOff = grandTotal - netTotal`, shown not hidden.
7. `statusFor` allows `paid + 0.005 ≥ total` so rounding on the last part-payment cannot leave an
   invoice a paisa short of Paid.

Place of supply: `placeOfSupplyCode = input.placeOfSupplyCode || party.stateCode || settings.stateCode`.
`interState = taxed && settings.stateCode && code && code !== settings.stateCode`.

### 8.2 Invoice numbering — `lib/billing/numbering.ts` + `invoices.ts`

`financialYear(date)` → `"2025-26"`, rolling on 1 April.
`formatInvoiceNo(prefix, year, seq)` → `BHX/2025-26/0001` (prefix upper-cased, non `[A-Z0-9-]` stripped).
`nextInvoiceNumber()` claims the sequence with `$inc` inside `findOneAndUpdate` on
`Counter { key: "invoice:BHX:2025-26" }`. Never read-then-write.
`dueDateFrom(invoiceDate, days)` — 0 days means payable on the spot.

### 8.3 Payroll — `lib/hr/payroll.ts` (pure, tested) + `payroll-run.ts` (database)

**Everything is in whole rupees** (`rupees()` = `Math.round`).

Statutory constants: `PF_WAGE_CEILING 15_000`, `PF_EMPLOYEE_RATE/PF_EMPLOYER_RATE 0.12`,
`EPS_RATE 0.0833` on `EPS_WAGE_CEILING 15_000`, `ESI_WAGE_CEILING 21_000`,
`ESI_EMPLOYEE_RATE 0.0075`, `ESI_EMPLOYER_RATE 0.0325`, `GRATUITY_RATE 0.0481`.
Professional tax is **slab data**, not code — `DEFAULT_PT_SLABS` is Karnataka's, editable in
settings; `ptFebruaryAmount` covers Maharashtra-style annual ceilings.

`computePayslip(input)` — the order *is* the rule:

1. Pro-rate **each earning head** by `paidDays / divisorDays` and round each one; the gross is their
   sum. Pro-rating the gross instead gives a payslip whose lines do not add up to its total.
2. PF follows the **basic actually paid**, capped at ₹15,000 unless `pfOnFullBasic`.
   Employer 12% splits into a pension share (8.33% of min(wages, 15 000)) and a fund share.
3. ESI **eligibility** is decided by the *full* monthly gross (≤ ₹21,000) so a month of leave cannot
   sweep somebody into the scheme; it is then **charged** on what is actually paid. Both sides round up.
4. Recurring recoveries (loan instalments) are **never pro-rated**.
5. Employer contributions are set out but never deducted — they make `costToCompany` honest.
6. `roundOff` is shown, so gross − deductions can always be checked against the bank figure.

`buildPayroll(month)` (no writes) → `saveDraftRun(month, actor)` (writes). The run:

- `onRollFor(month)` — everybody on the rolls at any point in the month (joiners, leavers, and
  people deactivated without an exit date are excluded).
- `structuresFor(ids, month)` — the latest revision with `effectiveFrom <= month`.
- `attendanceMonth(...)` → `daysFor(days, basis, joining, exit)` → `{divisorDays, onRollDays, lopDays}`.
- Anybody with no salary set, or no on-roll days, goes to `skipped[]` **with a reason**.
- `saveDraftRun` replaces the whole month: `$unset`s any prior approval/payment fields, deletes all
  payslips for the month and re-inserts. Only a draft may be replaced.

`lossOfPay(days)`: Absent = 1; On leave = 1 only when Unpaid; Half day = 0.5 unless it is paid leave.
**A day with no mark is not a loss** — an unmarked sheet must never dock somebody's salary.

State machine: `Draft →(approve, ADMIN)→ Approved →(pay)→ Paid`. `Approved →(reopen)→ Draft` is
allowed; **Paid is terminal**. `canEditRun` = Draft only; `canReopenRun` = Approved only.

### 8.4 Attendance and leave — `lib/hr/{attendance,leave,records}.ts`

`attendanceMonth(employeeIds, year, month)` resolves each day by precedence:

1. **Manual mark** — somebody looked and decided.
2. **Company holiday**.
3. **Approved leave** — marks itself; carries `leaveType` so payroll can tell paid from unpaid.
4. **A completed visit** — the rep's own work proves they were out (`inferredStatus`).
5. Otherwise `status: null` — "nobody has said yet", which is honestly different from Absent.

`summariseAttendance` — Present 1, Half day 0.5, everything else 0; Week off and Holiday are excluded
from `expected`.

Leave: `leaveDays(from, to, halfDay)` counts **every calendar day** in the range (a working-day
calendar does not exist yet, and under-counting leave is worse than counting plainly); a half day is
only meaningful on a single-day request. `leaveBalances(rows, entitlement)` — approved leave is
spent, pending leave is *held back* from `available`. Unpaid leave has no ceiling (`Infinity`).
`leaveYear()` runs with the financial year. Defaults: Casual 12, Sick 6, Earned 15, Compensatory 0.

### 8.5 Visits — `/api/visits/[id]` PATCH

- **`check-in`** — sets `checkInAt`, `status: "In progress"`, optional GPS; moves the plan to
  "In progress"; audits `visit.checked-in`.
- **`missed`** — `status: "Missed"`, `checkOutAt`, re-syncs the dispense ledger (which **returns**
  the stock, because a missed visit produces no rows); audits `visit.missed`.
- **`complete`** — stores outcome, products, samples, interest, order value, notes, follow-up; then:
  1. `syncDispenseLedger(visit)` — delete-then-insert this visit's DISPENSE rows.
  2. Updates the doctor: `lastVisitedAt`, and `stage` → Interested (interest High) /
     Not interested / Contacted (outcome "Met doctor").
  3. Closes the route plan when no Planned/In-progress visits remain.
  4. Audits `visit.completed` with a metadata summary.

### 8.6 Route planning — `lib/routing.ts` (pure, tested) + `lib/plans.ts`

`planRoute(doctors, referenceId, {startTime, visitMinutes, speedKmh = 25})`.

Greedy **nearest-feasible-next**: from each stop, compute for every remaining doctor when the meeting
could actually begin (travel time from `haversineKm` at 25 km/h, plus that doctor's call window on
the planned weekday), and take whoever can be seen soonest. Ties inside a **30-minute bucket** are
broken by distance so nearby doctors sharing a window stay together. A doctor still reachable in time
always beats one already missed. Waiting for a window to open is allowed; arriving after it closes is
not, and those stops are flagged `withinCallTime: false` rather than silently misplaced. Doctors with
no recorded window are flagged `timingUnknown`.

This is a heuristic, not a proven optimum — it says so rather than scheduling an impossible visit.

### 8.7 Doctor discovery — `lib/doctors/{discovery,places}.ts`

`DOCTOR_TYPES`, `RADIUS_OPTIONS [2..100] km`, `MAX_RESULTS 500`.
One Places call returns ~20 results near a point, so a wide search queries a **ring of sub-centres**
and merges by Place ID; `estimateGoogleRequests()` gives the ceiling before spending quota.
`toBulkPayload()` is shared by both save paths (office discovery and a rep adding one doctor) so the
mapping cannot drift. Excel round-trip: `EXCEL_COLUMNS`, `toExcelRow`, `fromExcelRow`.

### 8.7a Lead prospecting — `lib/sales/leads.ts` (pure, tested)

`LEAD_STATUSES`, `LEAD_SOURCES`, `LEAD_TYPE_SUGGESTIONS`, `MAX_LEAD_RESULTS 60`, `leadSearchSchema`,
`leadSaveSchema`, `leadUpdateSchema`, `toLead(place, type)`, `toLeadFields(row)`, `leadTone(status)`.

Reuses `lib/doctors/places.ts::{geocode, searchText}` rather than reimplementing them — the Places
call is the same call, only the mapping differs. **Sixty is Google's ceiling, not this code's**: text
search stops after three pages of twenty and there is no fourth page to ask for, so the screen says
so rather than promising a figure it cannot reach. `leadSearchPages()` asks for only the pages a
limit needs, because each one is billed.

`toLeadFields` exists for exactly two renames — `placeId` → `googlePlaceId`, `mapsUrl` →
`googleMapsUrl` — which are the two a spread would drop in silence, leaving a lead with no Maps link
and nothing to dedupe on.

There is **no radius and no sub-centre sweep** here, unlike doctor discovery. A route has to be
drivable, so that search sweeps a ring of centres and measures distance; a list of numbers to ring
does not, so the location only biases the query. Covering a city means searching its areas one at a
time under the same type.

### 8.8 Affiliate commission — `lib/sales/*` (pure parts tested)

**Everything is in whole rupees** (`rupees()` = `Math.round`): a payout advice reading ₹449.70
invites an argument that ₹450 does not.

**Attribution.** A rep holds codes built from their own code and a rule's digits — `RAUSHAN10`,
`RAUSHAN30`. `parseCoupon` splits one back into `{repCode, suffix}`; the suffix names the rule.
Anything not shaped like *name-then-digits* (`FREESHIP`, `DIWALI25` where no rep is DIWALI) is left
unattributed rather than guessed at. `attributeOrder` takes the first code on the order belonging to
a known rep, so a site-wide offer stacked on top is ignored.

**What a rate is applied to.** `computeCommission(lines, rule)`:

```
netOf(line) = max(0, gross − couponDiscount − otherDiscount − refunded)
base        = Σ netOf over the lines in scope
amount      = round(base × rate / 100)
```

Scope comes from the rule's `base`:

- **`Discounted lines`** (the default) — the lines Shopify recorded this coupon as discounting.
  Shopify allocates a code's discount per line item, so "the lines the coupon worked on" is a fact on
  the order and not a list anybody maintains: a code valid for one product pays on that product by
  itself. Where no line carries an allocation, the whole order is used and `wholeOrderFallback` says
  so on screen — paying on nothing and paying on everything are both worse than saying which happened.
- **`Whole order`** / **`Named products`** — every line, or lines matching a SKU/title list.

Worked through: the kit is MRP ₹2,299, the `30` code takes ₹800 off, so ₹1,499 was received and 30%
of that is ₹449.70 → **₹450**. The `10` code discounts one product by 10%, and 10% of what was paid
for it is the commission. One sentence covers both, which is why there is one function.

**When it is owed.** `commissionState`:

| | |
|---|---|
| `Pending` | not delivered yet |
| `Maturing` | delivered, inside the hold window (`maturesAt = deliveredAt + holdDays`) |
| `Payable` | the window has passed, no run has claimed it |
| `In payout` | on a draft or approved run — the figure is frozen |
| `Paid` | the run carrying it has been paid |
| `Void` | RTO, returned, cancelled, lost, refunded in full, or nothing received |

A delivery with no timestamp starts the clock from the moment we learned of it — stranding a rep's
earnings because Shiprocket omitted a date is not a policy anybody chose. See §4.13a for what is and
is not recomputed, and §4.13b for why maturity is a date comparison.

**Delivery states** — `lib/sales/delivery.ts` reduces Shiprocket's forty-odd statuses to six by
matching on words, in an order that matters: `RTO DELIVERED` and `RETURN DELIVERED` both contain
"delivered" and neither is a sale. An unrecognised status lands on `Awaiting`, which pays nobody,
rather than on a guess; `PARTIAL_DELIVERED` lands on `Undelivered` until a human sets the override.

**Payout runs** — `lib/sales/payout-run.ts`. `PO/2026-27/0004`, claimed with an atomic `$inc` on the
same `Counter` invoices use. `previewPayout` writes nothing; `savePayoutRun` re-prices the candidates,
*then* claims them with one conditional `updateMany` matching `status: "Payable"` — so two
administrators pressing Generate at the same moment cannot both promise the same money, because the
second matches nothing and produces a visibly empty run. State machine
`Draft →(approve, ADMIN)→ Approved →(pay)→ Paid`, `Approved →(reopen)→ Draft`, **Paid terminal**.

**The sync** — `lib/sales/sync.ts`. Two passes that fail independently, because a Shiprocket outage
must not stop new orders being attributed. Orders are pulled by Shopify's `updated_at` with **an
hour's overlap** on the last run: a window starting exactly where the last one ended will eventually
skip an order indexed a moment late, and a skipped order is a rep unpaid with nothing on any screen
to explain it. Every write is an upsert, so re-reading costs nothing. Shiprocket is joined on
`channel_order_id`, tried against every form the order could be filed under (`matchKeysFor`:
`#1042`, `1042`, the numeric id) because which one arrives depends on how the store was connected.

### 8.9 Audit actions — `lib/audit.ts`

`doctor.created`, `doctor.call-schedule.updated`, `visit.checked-in`, `visit.completed`,
`visit.missed`, `visit.photo.added`, `visit.photo.deleted`, `invoice.payment.proof.added`,
`invoice.payment.proof.removed`, `billing.qr.updated`, `billing.qr.removed`, `salary.revised`,
`salary.revision.deleted`, `payroll.generated`, `payroll.approved`, `payroll.reopened`,
`payroll.paid`, `payroll.deleted`, `payroll.settings.updated`,
`sales.rep.{created,updated,deactivated,deleted}`, `sales.delivery.overridden`, `sales.synced`,
`sales.settings.updated`, `sales.payout.{generated,adjusted,approved,reopened,paid,deleted}`.
`auditLabel(action)` gives the human sentence. Adding an action means adding it to `AUDIT_ACTIONS`.

---

## 9. UI layer

### 9.1 Rendering model

Pages are **server components** by default: they call `requireAdminPanel()` / `requireFieldPanel()`,
`connectDb()`, query directly, and pass plain data to client components. Only components needing
state, effects or events carry `"use client"`. Client components fetch through `/api/*`.

A consequence worth knowing: a helper exported from a `"use client"` module is a *client reference*
and throws if called during a server render. That is why `callTimeOn()` lives in
`lib/doctors/call-schedule.ts` rather than beside the picker that first needed it.

### 9.2 Design system — `components/ui/kit.tsx`

`Button` (tones, `busy`), `LinkButton`, `Card`, `PageTitle {title, subtitle, actions}`, `Badge`,
`statusTone(value)`, `Field {label, hint}`, `Stat {label, value, tone}`,
`Notice {tone: info|success|error}`, `EmptyState {icon, title, description, action}`, `Spinner`.
Also `Modal` (`ui/modal.tsx`, has a test), `BrandMark`/`Brand`, `PasswordInput`.

Use these rather than raw Tailwind for anything that already exists here.

### 9.2a Colour: tokens only — `app/globals.css`

**Never write a raw colour in a screen.** Every surface, line, ink and status colour is a CSS custom
property defined twice in `globals.css`: once on `:root` and once for dark. Names say what a colour
is *for*, so the same class works in both palettes — `--bg`, `--surface`, `--surface-2`,
`--surface-veil` (translucent, for sticky bars), `--overlay`, `--brand`, `--brand-hover`,
`--brand-soft`, `--on-brand` (**text on a brand fill** — the brand inverts to a light tan in dark,
so `text-white` on it is unreadable), `--ink`, `--ink-2`, `--muted`, `--line`, `--line-2`,
`--placeholder`, `--focus-ring`, and `--{ok,warn,danger,info}-{bg,ink,line}` for status.

Three theme states: `data-theme="dark"` and `data-theme="light"` on `<html>` beat the
`prefers-color-scheme` block, and no attribute at all follows the device. `lib/theme.ts` owns the
choice; `THEME_SCRIPT` runs **blocking in `<head>`** (see `app/layout.tsx`) because restoring the
theme in an effect flashes cream before hydration. `ThemeToggle` (`components/ui/theme-toggle.tsx`)
sits in both shells and on the login page.

The two print documents are the deliberate exception: they paint in fixed light ink because paper is
light whatever the screen is (§9.5). So do the badge over a visit photograph and the rating star.

### 9.3 Shells

`AdminShell` (`app/admin/layout.tsx`) — desktop sidebar navigation. Each `NAV` entry carries a
`workspace`, and the shell shows only the CRM the current path belongs to (§1), with a "Switch CRM"
link back to `/choose` for anybody who can reach both. `/admin`, `/admin/hr` and `/admin/sales` are
matched exactly, or each would light up on every screen beneath it.
`FieldShell` (`app/employee/layout.tsx`) — mobile bottom tabs: **Today, Plans, Doctors, Bills**, with
samples, history, leave, payslips and profile behind **More**.

### 9.4 Feature components

| Area | Components |
|---|---|
| Billing | `BillForm`, `CustomerForm`, `CustomerPicker`, `InvoiceDocument` (print layout), `InvoiceView`, `InvoiceRow` + `invoiceTone`/`invoiceLabel`, `PaymentForm`, `PaymentProof`, `PaymentQr`, `PrintButton` |
| Doctors | `CallScheduleEditor`, `DoctorCallTimeCard`, `DoctorDetailsForm`, `DoctorPicker` (+ `hasCoordinates`, `placeOf`) |
| Visits | `VisitForm`, `VisitPhotos` |
| Plans | `PlanAssignment`, `DeletePlanButton` |
| HR | `PayslipDocument`, `SalaryCard` |
| Sales | `SyncButton` (reports what a sync did, not just that it ran), `RepForm` (previews the coupon codes it will create), `OrderList` (+ the delivery override), `ImportOrders`, `AutomationPanel`, `LeadsScreen` (Search / Saved tabs), `LeadSearch` (results arrive ticked; saving is the second step), `LeadList` (status saves from the row, everything else from a dialog) |
| PWA | `ServiceWorker`, `InstallPrompt`, `ConnectionStatus` |

### 9.5 Print documents

`/invoices/[id]/print` and `/payslips/[id]/print` sit outside both panels (guarded by
`requireSession`, with the page itself deciding who may open that document). One link serves a desk
and a phone; "download as PDF" is the browser's own print-to-PDF.

### 9.6 PWA

`public/sw.js` is deliberately conservative: it caches build output and icons **only** — never
`/api` responses, never page HTML, because both are per-user and phones get shared.
**The app does not work offline**; losing coverage shows a banner and a cold navigation lands on
`public/offline.html`. A new deploy does not take over mid-form — the waiting worker idles behind a
"new version is ready" banner. Bump `VERSION` in `sw.js` to drop every cache on release.
`next.config.ts` forces `sw.js` and `offline.html` to revalidate every time.

---

## 10. Writing new code — recipes

### 10.1 Add an API route

```ts
// src/app/api/thing/route.ts
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Thing } from "@/models/Thing";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, pageParams, OBJECT_ID } from "@/lib/api";

const schema = z.object({ name: z.string().trim().min(2, "Name is required") });

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageThings);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = schema.parse(await request.json());
    const thing = await Thing.create({ ...input, createdBy: auth.session.userId });
    return ok({ _id: thing._id }, 201);
  } catch (error) {
    return fail(error);
  }
}
```

Checklist: guard → `connectDb()` → validate → check ownership if a rep could reach it → mutate →
sync any ledger → `record()` an audit line if it matters → `ok(...)`. Never let a client-supplied
total, balance or day-count reach the database.

### 10.2 Add a page

```tsx
// src/app/admin/thing/page.tsx  (server component)
import { requireAdminPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { PageTitle, Card } from "@/components/ui/kit";

export default async function ThingPage() {
  const session = await requireAdminPanel();
  await connectDb();
  const rows = await Thing.find({}).lean();
  return (
    <>
      <PageTitle title="Things" subtitle="What this screen is for" />
      <Card>{/* pass `rows` to a client component if it needs interaction */}</Card>
    </>
  );
}
```

### 10.3 Add a model

1. Create `src/models/Thing.ts` with the `models.Thing ?? model(...)` idiom and `{ timestamps: true }`.
2. Put its enums in a **pure** `lib/…` module and import them into the schema (so the browser can use
   them too).
3. **Add the import to `src/lib/db/mongoose.ts`** if anything will `populate()` it (§4.13).
4. Add indexes for every field you will filter or sort by.

### 10.4 Add a permission

Add the predicate to `can` in `src/constants/access.ts` with a comment saying *why* that role and not
another, extend `src/constants/access.test.ts`, then use it in `apiSession(can.newThing)` and to hide
the control in the UI. Never invent an inline role check in a route.

### 10.5 Add a field to the invoice

1. `models/Invoice.ts` — add it to the schema.
2. `lib/billing/compose.ts` — accept it in `billInputSchema` and emit it from `composeBill().fields`,
   so **both** POST `/api/invoices` and PUT `/api/invoices/[id]` get it for free.
3. `lib/billing/types.ts` — add it to `InvoiceRecord` so the browser can name it.
4. `components/billing/bill-form.tsx` and `invoice-document.tsx` — capture and print it.

`followUps` is the one field deliberately **not** in `composeBill().fields`: it is a list carrying
marks the client does not hold, so the routes merge it with `applyFollowUps` instead. A field that
the server knows more about than the request does belongs there too, not in `fields`.

### 10.6 Style conventions observed throughout

- British-English prose in comments; comments explain **why**, not what.
- `const` arrow helpers for one-liners, `function` for exported logic.
- `?.` / `??` freely; `.lean()` on every read-only query, with an explicit cast.
- Errors are sentences a user can act on, naming the figures and the way out: `"₹500.00 has already
  been received against this bill, so it cannot be re-priced to ₹400.00. Bill at least what has been
  paid, or remove a receipt under Payments first."` — not `"Invalid state"`.
- Enum arrays are `as const` and their type derived with `(typeof X)[number]`.

---

## 11. Traps

| Trap | What happens | Do this |
|---|---|---|
| `$match` does not cast | A string id in an aggregation `$match` silently matches nothing, so totals come back zero while `find()` works. | Wrap ids in `new Types.ObjectId(...)` for any filter reused in an aggregation — see `/api/invoices` GET. |
| Overwriting `filter.status` | Writing a literal `status` beside a filter that already set one makes summary cards total every bill while the count shows the filtered few. | Fold extra conditions into `$and`. |
| A key called `type` in a nested object | Mongoose reads it as the type declaration and turns the whole parent into a String field. | Spell it `type: { type: String }` (see `Invoice.billTo.type`). |
| Dates at midnight | `toISOString()` east of UTC reports the previous day, so a saved plan or invoice walks its date backwards. | `fromDateInput()` anchors at **local midday**; `toDateInput()` formats locally. |
| Appending derived ledger rows | Re-submitting a completed visit or re-saving an invoice doubles the stock movement. | Always delete-then-insert: `syncDispenseLedger`, `syncInvoiceStock`. |
| Renaming a product | Both ledgers key on `productName`, so the balance is stranded under the old name and the product reads zero. | Call `renameProductInLedgers(from, to)`. |
| Forgetting `recalculate()` | `amountPaid` / `balanceDue` / `status` drift away from `payments[]`. | Call it after any change to `payments`. |
| Model not imported in `mongoose.ts` | `populate()` throws `MissingSchemaError` — but only on a cold server, so it looks intermittent. | Add the import. |
| Selecting a `select: false` field by accident | A list route drags megabytes of image bytes per row. | Only the single-item byte-serving route uses `.select("+data")` / `+paymentQr`. |
| A raw Tailwind colour in a screen | `bg-white` / `text-neutral-500` / `bg-amber-50` do not follow the theme, so the screen is unreadable in dark — and `text-white` on `bg-[var(--brand)]` is unreadable the moment the brand inverts. | Paint with the tokens (§9.2a). Text on a brand fill is `text-[var(--on-brand)]`. |
| Counting billed units for stock | Scheme goods leave the warehouse and are on no total, so the shelf silently runs ahead of reality. | `unitsSupplied()` — the only counter `syncInvoiceStock` and the shortage warning use. |
| A GeoJSON field with a `type` default | `{ type: "Point" }` and no coordinates is written on every new record, and the 2dsphere index fails the whole insert — the screen can only say "something went wrong". | No default on `location.type`; the model's hooks run every write through `completePoint()`. |
| `new Uint8Array(doc.data)` after `.lean()` | Lean returns a BSON `Binary`, not a `Buffer`, so the response is 200 with **zero bytes** and the QR, photo or proof shows as a broken image. | Unwrap with `storedBytes()` (`lib/db/bytes.ts`) and test `bytes.byteLength`, never `data.length`. |
| Trusting `leaveDays` from the client | Somebody grants themselves a month. | It is recomputed on the server; keep it that way. |
| Assuming an unmarked attendance day is an absence | Payroll would dock salary nobody authorised. | `status: null` means "nobody has said yet" and costs nothing. |
| Letting one person prepare *and* approve payroll | The oldest hole in any set of books. | `runPayroll` ≠ `approvePayroll`. |
| Reopening a Paid payroll month | Money has left the bank. | Corrections are a later entry, never a rewrite. |
| Rounding CGST and SGST separately | The two halves stop adding to the line's tax. | `sgst = money(tax - cgst)`. |
| JSX in tests | `tsconfig` uses `jsx: "preserve"` for Next, which breaks esbuild under vitest. | `vitest.config.ts` already sets `esbuild.jsx: "automatic"` — do not remove it. |
| Reading `RTO DELIVERED` as a delivery | The string contains "delivered", so a naive match pays commission on a parcel that came *back*. Same for `RETURN DELIVERED`. | `deliveryStateFrom` checks RTO and RETURN **before** DELIVERED. The order of those rules is the point of the module. |
| Querying payouts on `status: "Payable"` alone | A commission that matured overnight is still stored as `Maturing`, so the run silently skips it and the rep waits another week. | Match on `maturesAt <= end` with status in `["Maturing", "Payable"]` (§4.13b). |
| Recomputing a claimed commission | An approved run's figures change underneath it, and an approval stops meaning anything. | `recalculateCommission` leaves `In payout` / `Paid` alone and raises `needsReversal` instead (§4.13a). |
| Syncing Shopify from `created_at` | A month-old order refunded this morning never comes back through, so its commission is never voided. | Pull by `updated_at`, with an hour's overlap on the last run. |
| Paging Shopify with filters still attached | Shopify rejects `page_info` sent alongside anything but `limit`, so the second page 400s. | `fetchOrders` drops every filter once it holds a cursor. |
| Two reps sharing a coupon code | Every order it brings in becomes unattributable, with no way to work out afterwards whose it was. | The unique index on `coupons.code`, plus the explicit check in the rep routes. |
| Deleting a coupon from a rep | Orders already attributed point at a code that no longer exists. | Withdrawn codes are set `active: false` and kept. |
| Putting a Shopify token in `.env` | It cannot then be rotated without a redeploy, and it sits in plain sight in the dashboard. | Credentials live in `SalesSettings`, `select: false` and encrypted (`lib/sales/secrets.ts`). |
| Trusting the `shop` parameter on the OAuth callback | It is attacker-chosen and becomes the host the client secret is posted to. | `safeShopDomain` refuses anything but `<handle>.myshopify.com` **before** it reaches a URL. A suffix check would pass `shop.myshopify.com.evil.com`. |
| Sending somebody to Shopify's admin to "create a custom app" | That button was removed on 1 January 2026, so the instruction describes a screen that is not there. | Dev Dashboard app + the OAuth flow in `lib/sales/oauth.ts`. |

---

## 12. Task → files index

| Task | Open these |
|---|---|
| Change GST arithmetic | `lib/billing/gst.ts` (+ `gst.test.ts`) |
| Change what a bill contains | `lib/billing/compose.ts`, `models/Invoice.ts`, `lib/billing/types.ts`, `components/billing/bill-form.tsx` |
| Change invoice numbering | `lib/billing/numbering.ts`, `lib/billing/invoices.ts` |
| Change how the printed bill looks | `components/billing/invoice-document.tsx`, `app/invoices/[id]/print/page.tsx` |
| Payment / receipt behaviour | `app/api/invoices/[id]/payments/route.ts`, `lib/billing/invoices.ts::recalculate` |
| Follow-ups / collection chasing | `lib/billing/follow-ups.ts` (+ `follow-ups.test.ts`), `app/api/invoices/[id]/follow-ups/route.ts`, `components/billing/follow-up-editor.tsx` |
| Payment proof upload | `app/api/invoices/[id]/payments/[paymentId]/proof/route.ts`, `models/PaymentProof.ts`, `lib/billing/attachments.ts` |
| Seller details / payment QR | `models/Settings.ts`, `app/api/billing/settings/**`, `app/admin/billing/settings/page.tsx` |
| Payroll figures | `lib/hr/payroll.ts` (+ `payroll.test.ts`, `payroll-days.test.ts`) |
| Payroll month assembly | `lib/hr/payroll-run.ts`, `app/api/hr/payroll/**` |
| Payslip layout | `components/hr/payslip-document.tsx`, `app/payslips/[id]/print/page.tsx` |
| Attendance resolution | `lib/hr/records.ts`, `lib/hr/attendance.ts` |
| Leave rules | `lib/hr/leave.ts`, `app/api/hr/leave/**` |
| Employment record fields | `models/User.ts`, `app/api/team/[id]/route.ts`, `app/admin/team/[id]/page.tsx` |
| Route ordering | `lib/routing.ts` (+ `routing.test.ts`), `lib/plans.ts` |
| Call windows | `lib/doctors/call-schedule.ts`, `models/Doctor.ts`, `components/doctors/call-schedule-editor.tsx` |
| Visit flow | `app/api/visits/[id]/route.ts`, `components/visits/visit-form.tsx`, `lib/visits.ts` |
| Visit photos | `models/VisitPhoto.ts`, `app/api/visits/[id]/photos/**`, `components/visits/visit-photos.tsx` |
| Rep sample stock | `lib/samples/{movements,ledger}.ts`, `app/api/samples/**` |
| Warehouse stock | `lib/inventory/{movements,ledger}.ts`, `app/api/inventory/**`, `app/admin/inventory/page.tsx` |
| Product catalogue | `models/Catalog.ts`, `app/api/products/**`, `app/admin/products/page.tsx` |
| Google discovery | `lib/doctors/{discovery,places}.ts`, `app/api/google/**`, `app/admin/discover/page.tsx` |
| Lead prospecting (Sales CRM) | `lib/sales/leads.ts` (+ `leads.test.ts`), `app/api/sales/leads/**`, `components/sales/{leads-screen,lead-search,lead-list}.tsx` |
| Excel import/export | `lib/doctors/discovery.ts`, `app/api/doctors/{export,bulk}/route.ts` |
| Commission arithmetic | `lib/sales/commission.ts` (+ `commission.test.ts`) |
| Coupon → rep attribution | `lib/sales/coupons.ts`, `lib/sales/sync.ts::couponIndex` |
| Reading a courier status | `lib/sales/delivery.ts` (+ `delivery.test.ts`) |
| Payout periods and totals | `lib/sales/payouts.ts` (+ `payouts.test.ts`) |
| Payout run assembly | `lib/sales/payout-run.ts`, `app/api/sales/payouts/**` |
| Shopify or Shiprocket calls | `lib/sales/{shopify,shiprocket,http}.ts` |
| Booking a parcel with the courier | `lib/sales/fulfilment.ts` (pure, + test), `lib/sales/booking.ts`, `app/api/sales/{orders/process,orders/documents,fulfilment/**}` |
| What the sync does | `lib/sales/sync.ts`, `app/api/sales/{sync,cron}/route.ts` |
| Affiliate credentials | `lib/sales/{settings,secrets}.ts`, `app/api/sales/settings/**` |
| Connecting Shopify (OAuth) | `lib/sales/oauth.ts` (+ `oauth.test.ts`), `app/api/sales/shopify/{install,callback}` |
| Sales dashboards and figures | `lib/sales/reporting.ts`, `app/admin/sales/**` |
| Which CRM a screen belongs to | `lib/workspace.ts`, `components/layout/admin-shell.tsx`, `app/choose/page.tsx` |
| Permissions | `constants/access.ts` (+ `access.test.ts`) |
| Session / login | `lib/auth/{session,guard}.ts`, `middleware.ts`, `app/api/auth/**` |
| Navigation | `components/layout/{admin-shell,field-shell}.tsx` |
| Shared UI | `components/ui/kit.tsx` |
| Offline / install behaviour | `public/sw.js`, `components/pwa/*`, `next.config.ts` |
| Reports | `app/api/reports/route.ts`, `app/admin/reports/page.tsx` |
| Audit trail | `lib/audit.ts`, `app/admin/team/[id]/activity/page.tsx` |

---

## 13. Tests

Co-located `*.test.ts` next to the module they cover; `npm test` runs vitest once.

| File | Covers |
|---|---|
| `constants/access.test.ts` | the whole permission matrix |
| `lib/billing/gst.test.ts` | line pricing, inclusive rates, CGST/SGST split, round-off, words |
| `lib/billing/follow-ups.test.ts` | which chase is next, the `followUpDate` mirror, marks kept through an edit |
| `lib/hr/payroll.test.ts` | payslip composition, PF/ESI/PT |
| `lib/hr/payroll-days.test.ts` | divisor days, on-roll days, loss of pay |
| `lib/hr/hr.test.ts` | leave counting and balances |
| `lib/routing.test.ts` | call-window ordering, conflicts, distance tie-breaks |
| `lib/time.test.ts` | clock parsing, local-date conversions |
| `lib/visits.test.ts` | photo retention arithmetic |
| `lib/samples/movements.test.ts` | signed quantities, `foldStock`, dispense rows |
| `lib/inventory/movements.test.ts` | signed stock, `foldLevels`, `levelChange`, alerts |
| `lib/doctors/discovery.test.ts` | Places mapping, Excel round-trip |
| `lib/sales/commission.test.ts` | coupon parsing and attribution, the ₹450 kit and the 10% case, refunds and stacked offers, the hold window, what a claimed commission keeps, `recalculateCommission` |
| `lib/sales/delivery.test.ts` | Shiprocket's vocabulary, and that `RTO DELIVERED` never reads as a sale |
| `lib/sales/payouts.test.ts` | period proposal, calendar arithmetic, closing-day boundaries, signed adjustments, run totals |
| `lib/sales/secrets.test.ts` | credential round-trip, and that the stored form is parsed from the **end** — the `enc.v1` prefix carries a dot, so a value has six parts and not five |
| `lib/sales/shopify.test.ts` | shop-address normalisation (admin URL, bare handle, storefront domain), and the discount-allocation mapping that decides whose commission an order is |
| `lib/sales/oauth.test.ts` | the shop-domain guard against a forged `shop` parameter, the authorize URL, and HMAC verification against a tampered or wrongly-signed callback |
| `lib/sales/leads.test.ts` | Places → lead mapping (including the place with no coordinates, which is kept), the two renames in `toLeadFields`, the search schema's insistence on a type, and that no fourth Google page is ever asked for |
| `lib/sales/fulfilment.test.ts` | COD against prepaid, the ten digits of a phone however it was stored, the fields whose absence a courier refuses, that a booked parcel is never booked twice, the adhoc body (filed under the shop's own order name, priced at what was actually paid), and the courier rules — including that a named courier is never substituted |
| `lib/sales/shiprocket.test.ts` | the booking calls against a stubbed `fetch`: what is sent where, and that a **200 which says no** — `awb_assign_status: 0` — is a failure carrying Shiprocket's own words rather than a silent success |
| `components/ui/modal.test.tsx`, `components/sales/process-{screen,orders}.test.tsx` | the three rendered-component tests: the picking list opens on what still has to go out and says on each row why one cannot, and the booking dialog chunks a long selection without losing an order between chunks, leaves out what it already knows cannot be booked, and never carries one order's address into a batch |

**New arithmetic belongs in a pure module with a test.** Database code is exercised through the
routes, not unit-tested.

---

## 14. Known limitations

- Google Places cannot guarantee every doctor in an area, and rarely returns an email.
- A doctor needs coordinates to appear in a route plan; manually added ones must have them entered.
- Travel time is straight-line distance at 25 km/h — a planning aid, not live traffic.
- Route ordering is greedy, not optimal; it reports conflicts rather than hiding them.
- Password reset is administrator-assisted (no mail provider configured).
- Excel import runs inline, so very large sheets are best split.
- **No offline support** — see §9.6.
- Leave counting includes weekends (no working-day calendar yet).
- Affiliate reps have **no login**. Everything about them is read and settled from the admin panel;
  `SalesRep.user` exists so adding rep-facing screens later needs no backfill.
- The sync runs **inline** in the request. Right for a few hundred orders a week; a much larger shop
  would want it moved off the request.
- A commission paid out before a late return is **not clawed back automatically**. The order is
  flagged `needsReversal` and shown on the dashboard; recovery is a named negative adjustment on a
  later run. Shortening `holdDays` makes this more likely.
- `channel_order_id` is matched against several shapes (§8.8). If a Shiprocket account files orders
  under something else again, deliveries will not join and every commission stays `Pending` — the
  sync report's unmatched count is what shows it.
- A partial delivery is deliberately read as `Undelivered` and waits for a manual override.

---

*This document describes the repository as of commit `a8a2486`. When you change a model, a route, a
permission or an invariant, update the matching section here in the same change.*
