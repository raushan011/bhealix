# The invoice vault

Every bill BHEALIX **receives**, gathered in one place and filed by month, so the
accountant gets one archive instead of four dashboard logins.

Lives at **Super admin → Invoice vault** (`/admin/control/invoices`) and is held
by the `SUPERADMIN` role alone.

---

## Why it is not part of Billing

`/admin/billing` is money owed **to** the company: an invoice raised on a doctor
or a stockist, chased, receipted. This is the opposite direction — what
Shiprocket, Razorpay, Shopify and Meta charged **us**. Nothing joins the two and
nothing should. One is revenue; the other is the purchase paper the GST input
credit sits on.

---

## Getting a super administrator

Nothing in the application creates one, and that is the security model rather
than an oversight. `SUPERADMIN` is deliberately off the Employees screen's role
list (`ASSIGNABLE_ROLES`), because that screen is reached by `manageEmployees` —
which HR holds as well as the administrator — and a role anybody there could
assign is not a role above them. The same reasoning closes the account itself:
its role, its password, its active flag and its deletion are all refused to
everybody below it, since an administrator who could set that password could
simply sign in as them.

So it takes shell access, from the project directory:

```bash
npm run super-admin                                             # list the desk accounts
npm run super-admin -- boss@bhealix.com                         # promote an existing one
npm run super-admin -- boss@bhealix.com --create --name "…"     # a separate credential
```

**Run it with no arguments first.** It prints which database it is talking to and
every desk account on it, which is the answer to "no account with that email" —
usually the address is simply not the one you remembered.

**Promoting** changes the role and nothing else: the name, password, employment
record and history stay exactly as they were. To take it back, set the role to
Administrator from **Admin → Employees**.

**`--create`** makes an account that need not be an employee at all — a login
that exists only to hold the books. It prints a generated password once, or takes
`--password "…"`.

The script reads `MONGODB_URI` from the environment in preference to
`.env.local`, so it can be pointed at staging: `MONGODB_URI=… npm run
super-admin`. It names the database it connected to on every run.

## Signing in

`/super-admin` is the door. It lands directly on the control panel rather than on
the CRM chooser, and refuses an account that is not a super administrator before
any cookie is set — with a sentence saying so, rather than the "incorrect
password" that would have somebody conclude their account was broken.

**It is a door, not a lock.** The address is not a secret and knowing it grants
nothing: the password and the role are what protect the account, and the same
person can sign in at `/login` and reach the same panel through the chooser.
What it buys is one address to remember and a refusal that explains itself.

---

## What it tracks

Seven sources. Shiprocket appears three times on purpose: they are three
different documents raised by three different parts of that company against three
different expenses, and a CA reconciles them separately.

| Source | What it is | How it arrives |
|---|---|---|
| Shiprocket — wallet recharge | Money put into the wallet: freight paid in advance | Upload |
| Shiprocket — order tax invoices | The tax invoice against each shipment | **Fetched automatically** |
| Shiprocket — checkout charges | What Shiprocket Checkout bills for the cart it powers | Upload |
| Razorpay — gateway fees | Razorpay's monthly tax invoice for what it charged | Upload |
| Shopify — subscription & apps | The plan, the apps on it, transaction fees | Upload |
| Meta — ads billing | Facebook and Instagram advertising receipts | Upload |
| Offline & other | Anything on paper or by email: the CA's fee, rent, a manual courier bill | Upload |

### Why only one of them is automatic

Because only one of them **can** be, and saying so plainly is better than a sync
button that quietly does nothing.

Shiprocket's order invoices are fetchable because this application already books
those parcels: it holds the credentials (under **Sales CRM → Settings**), knows
each order's Shiprocket id, and already calls the endpoint that renders their
invoices — the same one the picking desk prints from. Pointing that at the
accountant is not a new integration.

The other six are published in their vendor's own dashboard and on no API this
account can call. A "sync" written against them would file nothing and leave the
month looking synced and empty, which on screen is indistinguishable from a month
with no bills in it. So instead the vault:

- links straight to each vendor's billing page from the card and the upload box,
- takes the file in two clicks once it has been downloaded,
- and **says which months are missing which vendor**, on the card and on the
  super admin overview, until somebody files it.

If any of those vendors opens up a billing API this account can reach, one
connector in `src/lib/finance/pull.ts` and one flag in `src/lib/finance/sources.ts`
turns that source from an upload into a pull. Nothing else changes.

---

## The month

The vault works a month at a time — the accountant works in months, the vendors
bill in months, and a screen showing everything at once answers no question
anybody has.

- **Filing.** The **file is the record**; every other field is optional. A form
  that refuses an invoice until somebody has read the tax figure off it is a form
  that ends with the invoice still in the Downloads folder. Amounts can be typed
  onto the row later.
- **The month it belongs to is chosen, not inferred.** A Meta receipt dated the
  2nd of September is usually August's advertising, and a wallet recharge made in
  March pays for April. Filing something outside the month it is dated in is
  allowed and produces a note, not a refusal.
- **Sent to the CA.** Marking a month sent records the date and who sent it, so
  "when did you send me August" has an answer three weeks later. Marking an
  incomplete month sent asks once and then does it — a slow vendor is not a
  reason to miss a filing date.
- **A note per month** for what is still outstanding.

---

## The archive

**Download month** produces one ZIP:

```
Bhealix vendor invoices — Aug 2026.zip
├── Contents.csv
├── Shiprocket/
│   ├── 2026-08 — Wallet recharge — SR-4471.pdf
│   └── 2026-08 — Order tax invoices — Tax invoices for 30 shipments.pdf
├── Razorpay/
│   └── 2026-08 — Gateway fees — RZP-8891.pdf
└── Meta/
    └── 2026-08 — Ads billing — 240-8817263.pdf
```

- **A folder per vendor**, because that is how the reconciliation is done.
- **Names rebuilt from the record.** Shiprocket calls every invoice
  `invoice.pdf` and Meta calls every receipt `Receipt.pdf`; a folder of those
  identifies nothing and, worse, collides — two identical entries in a ZIP
  extract as one file, silently.
- **`Contents.csv` first** — month, vendor, document, number, date, amount, tax,
  currency, description, whether it was pulled or filed by hand, the file it
  points at, and any note. It is the single most useful thing in the download:
  the totals can be tied to the bank statement without opening a single PDF, and
  a missing line is visible at a glance. It leads with a byte-order mark so Excel
  reads it as UTF-8 rather than turning every rupee sign into mojibake.

**Download <vendor> only** takes one supplier's slice of the month. Ticking rows
and pressing **Download selected** takes exactly those.

The ZIP is written by hand (`src/lib/finance/zip.ts`) rather than by a
dependency — the stored-and-deflated subset of the format is about a hundred
lines and has not changed since 1993. PDFs and images are stored as they are,
since deflating something already deflated only adds framing; CSVs and anything
else are deflated.

---

## Limits

| | |
|---|---|
| One file | 20 MB |
| One archive | 180 MB, and it says what it left out rather than dying halfway |
| File types | PDF, JPEG, PNG, WebP, CSV, XLS, XLSX |
| One Shiprocket pull | 20 batches of 30 shipments; press again to continue where it stopped |

A file's reported type is checked against its extension rather than trusted
outright — Windows reports a `.csv` as `application/vnd.ms-excel` whenever Excel
is installed, and refusing a good invoice over a header nobody controls is the
wrong failure.

---

## What leaves a trail

Filing, correcting, deleting, pulling, downloading an archive, and marking a
month sent or reopened all write an audit line. A deleted invoice is a deduction
that quietly stops existing, so its month, source, number and amount are copied
into the trail on the way out — after that, the audit line is the only remaining
evidence the claim was ever made.

---

## Where the code lives

```
src/lib/finance/sources.ts    the seven sources, and which can be fetched
src/lib/finance/period.ts     "2026-08" — months, ranges, the financial year
src/lib/finance/documents.ts  the list, and the month summary the checklist reads
src/lib/finance/archive.ts    how the ZIP is laid out and named; the manifest
src/lib/finance/zip.ts        the ZIP writer
src/lib/finance/pull.ts       the Shiprocket order-invoice fetch
src/lib/finance/files.ts      accepted types and size limits, shared with the browser
src/models/Finance.ts         VendorInvoice, FinancePeriod
src/app/api/finance/…         list, upload, file, archive, pull, month state
src/components/finance/…      the vault screen and the upload dialog
```
