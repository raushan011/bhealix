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

Two panels, one app: `/admin` (desktop, for ADMIN + HR) and `/employee` (mobile PWA, for MR + SALES).

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
| Billing | `Invoice`, `Customer`, `PaymentProof`, `BillingSettings`, `Counter` | `lib/billing/{constants,gst,numbering,types,customers,attachments}` | `lib/billing/{invoices,compose}.ts` | `/api/invoices`, `/api/customers`, `/api/billing` |
| HR | `LeaveRequest`, `Attendance`, `Holiday` | `lib/hr/{leave,attendance}` | `lib/hr/records.ts` | `/api/hr/{leave,attendance,holidays,overview}` |
| Payroll | `SalaryStructure`, `PayrollRun`, `Payslip`, `PayrollSettings` | `lib/hr/payroll.ts` | `lib/hr/payroll-run.ts` | `/api/hr/{payroll,payslips,salary}` |
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
│   │   └── reports/page.tsx
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
│   ├── billing/     bill-form, customer-form, customer-picker, invoice-document,
│   │                invoice-row, invoice-view, payment-form, payment-proof,
│   │                payment-qr, print-button
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
│   └── samples/     movements, ledger
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

Matches `/admin/*`, `/employee/*`, `/invoices/*`, `/payslips/*`, `/api/*`. Public: `/api/auth/login`,
`/api/auth/logout`. Verifies the JWT; on failure returns 401 for API paths and redirects to
`/login?next=…` for pages. Keeps desk roles (`ADMIN`, `HR`) out of `/employee` and field roles out of
`/admin`. Sets `x-content-type-options: nosniff`, `x-frame-options: DENY`,
`referrer-policy: strict-origin-when-cross-origin`.

`/invoices` and `/payslips` are deliberately reachable by both panels — the page itself decides who
may open that particular document.

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

---

## 6. Data model

13 model files, 18 collections. Every schema uses `{ timestamps: true }` unless noted, and the
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
| `code` | String | required, unique — `BHX-00001` |
| `name` | String | required, indexed |
| `specialties` | [String] | |
| `clinicName`, `phones[]`, `email`, `website` | | |
| `fullAddress`, `area`, `city`, `pinCode` | String | `area`, `city` indexed |
| `state`, `stateCode`, `gstin` | String | billing identity, captured on first invoice |
| `location` | GeoJSON Point | `coordinates: [longitude, latitude]` |
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

**Lines** — `items[]`: `product`, `name` (req), `hsnCode`, `unit`, `quantity`, `rate`,
`discountType` PERCENT|AMOUNT, `discountValue`, `gstRate`, then the server-computed
`gross`, `discount`, `taxableValue`, `cgst`, `sgst`, `igst`, `taxAmount`, `total`.
`taxSummary[]`: `{hsnCode, gstRate, taxableValue, cgst, sgst, igst}` — the rate-wise block a GST
invoice must print.

**Totals** — `subtotal`, `totalDiscount`, `taxableValue`, `cgstTotal`, `sgstTotal`, `igstTotal`,
`taxTotal`, `roundOff`, `grandTotal`.

**Money in** — `payments[]`: `amount` (≥0.01), `mode` enum `PAYMENT_MODES`, `reference`, `paidAt`,
`receivedBy` → User, `recordedBy` → User, `notes`, `proof?` (metadata only — bytes live in
`PaymentProof`). Cached: `amountPaid`, `balanceDue`, `status` enum `INVOICE_STATUSES`.

**Dates** — `invoiceDate` (req, indexed), `dueDate` (indexed), `paymentTerms` (days),
`followUpDate` (indexed).

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
`defaultPaymentTerms`, `defaultGstRate` 18, `ratesIncludeTax`, `terms`, `signatoryName`).

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
| | PUT | `manageBilling` | rewrite via the same `composeBill`. **Refused once any payment exists**, and once cancelled. Keeps `invoiceNo`, `financialYear`, sets `updatedBy`, re-syncs stock |
| | PATCH | `manageBilling` | `{dueDate?, followUpDate?, notes?, terms?, cancel?, cancelReason?}`. Cancelling is refused if money has been received; a cancelled invoice writes no stock rows, which returns the goods |
| | DELETE | `manageBilling` | only with no payments; also deletes its `StockMovement`s and any `PaymentProof`s |
| `/api/invoices/[id]/payments` | POST | `recordPayment` + ownership for reps | `{amount>0, mode, reference?, paidAt?, notes?}`. Refused when cancelled or already Paid, or when the amount exceeds `balanceDue + 0.5`. `receivedBy` = the rep (field) or the bill's owner (admin). Returns `{status, amountPaid, balanceDue, payments, payment: <new receipt id>}` |
| | DELETE `?payment=<id>` | `manageBilling` | removes the receipt **and** its `PaymentProof` |
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
  invoiceDate: "yyyy-mm-dd", dueDate?, paymentTerms 0..365 = 0, followUpDate?,
  placeOfSupplyCode?: <state code>,
  billTo?: { name?, clinicName?, type?, gstin?, address?, city?, pinCode?, phone? },
  saveDoctorDetails = true,
  items: [{ product?, name, hsnCode?, unit?, quantity>0, rate≥0,
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

### 8.8 Audit actions — `lib/audit.ts`

`doctor.created`, `doctor.call-schedule.updated`, `visit.checked-in`, `visit.completed`,
`visit.missed`, `visit.photo.added`, `visit.photo.deleted`, `invoice.payment.proof.added`,
`invoice.payment.proof.removed`, `billing.qr.updated`, `billing.qr.removed`, `salary.revised`,
`salary.revision.deleted`, `payroll.generated`, `payroll.approved`, `payroll.reopened`,
`payroll.paid`, `payroll.deleted`, `payroll.settings.updated`.
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

### 9.3 Shells

`AdminShell` (`app/admin/layout.tsx`) — desktop sidebar navigation.
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

### 10.6 Style conventions observed throughout

- British-English prose in comments; comments explain **why**, not what.
- `const` arrow helpers for one-liners, `function` for exported logic.
- `?.` / `??` freely; `.lean()` on every read-only query, with an explicit cast.
- Errors are sentences a user can act on: `"Money has been received against this bill. Remove the
  receipts first, then edit it."` — not `"Invalid state"`.
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
| Trusting `leaveDays` from the client | Somebody grants themselves a month. | It is recomputed on the server; keep it that way. |
| Assuming an unmarked attendance day is an absence | Payroll would dock salary nobody authorised. | `status: null` means "nobody has said yet" and costs nothing. |
| Letting one person prepare *and* approve payroll | The oldest hole in any set of books. | `runPayroll` ≠ `approvePayroll`. |
| Reopening a Paid payroll month | Money has left the bank. | Corrections are a later entry, never a rewrite. |
| Rounding CGST and SGST separately | The two halves stop adding to the line's tax. | `sgst = money(tax - cgst)`. |
| JSX in tests | `tsconfig` uses `jsx: "preserve"` for Next, which breaks esbuild under vitest. | `vitest.config.ts` already sets `esbuild.jsx: "automatic"` — do not remove it. |

---

## 12. Task → files index

| Task | Open these |
|---|---|
| Change GST arithmetic | `lib/billing/gst.ts` (+ `gst.test.ts`) |
| Change what a bill contains | `lib/billing/compose.ts`, `models/Invoice.ts`, `lib/billing/types.ts`, `components/billing/bill-form.tsx` |
| Change invoice numbering | `lib/billing/numbering.ts`, `lib/billing/invoices.ts` |
| Change how the printed bill looks | `components/billing/invoice-document.tsx`, `app/invoices/[id]/print/page.tsx` |
| Payment / receipt behaviour | `app/api/invoices/[id]/payments/route.ts`, `lib/billing/invoices.ts::recalculate` |
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
| Excel import/export | `lib/doctors/discovery.ts`, `app/api/doctors/{export,bulk}/route.ts` |
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
| `lib/hr/payroll.test.ts` | payslip composition, PF/ESI/PT |
| `lib/hr/payroll-days.test.ts` | divisor days, on-roll days, loss of pay |
| `lib/hr/hr.test.ts` | leave counting and balances |
| `lib/routing.test.ts` | call-window ordering, conflicts, distance tie-breaks |
| `lib/time.test.ts` | clock parsing, local-date conversions |
| `lib/visits.test.ts` | photo retention arithmetic |
| `lib/samples/movements.test.ts` | signed quantities, `foldStock`, dispense rows |
| `lib/inventory/movements.test.ts` | signed stock, `foldLevels`, `levelChange`, alerts |
| `lib/doctors/discovery.test.ts` | Places mapping, Excel round-trip |
| `components/ui/modal.test.tsx` | the one rendered-component test |

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

---

*This document describes the repository as of commit `a8a2486`. When you change a model, a route, a
permission or an invariant, update the matching section here in the same change.*
