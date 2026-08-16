# BHEALIX CRM

Doctor discovery, MR call scheduling, route planning and field visit tracking for BHEALIX, a skincare brand.

Built for phones first — reps use it standing in a clinic corridor — and equally usable on a desktop for the admin team.

## What it does

**Phase 1 — build the doctor base**
- Search any location (city, area or PIN code) within a 100 km radius for skin specialists, using Google Places.
- Filter by doctor type: dermatologist, cosmetologist, trichologist, acne/pigmentation specialist and more.
- Save results to the directory, export the whole directory to Excel, and upload an edited sheet back.
- Record each doctor's **MR call time**: which days they see representatives, the exact time slots, whether an appointment is needed, and any remarks.

**Route planning built around call times**
- Pick a date, a starting doctor, and the doctors to visit.
- The route is ordered by **call time first and distance second**. A doctor who only sees reps from 2–4 PM will not be scheduled for 10 AM however close they are.
- Every stop gets a planned arrival time. Doctors who cannot be reached inside their window are flagged rather than silently misplaced.
- Assign the plan to an MR or sales executive; their day is created automatically.

**Field work**
- Reps **add doctors themselves** — searched by name so Google supplies the address and map location, or entered by hand with the phone's own position as the coordinate. A doctor added by a rep lands in that rep's list.
- Reps **plan their own round**: pick a start, add who they are seeing, and the same engine orders it by call time first and distance second.
- Five tabs on the phone — Today, Plans, Doctors, Bills — with samples, history, leave and profile behind **More**.
- The rep opens the app to today's route in visiting order, with call times, addresses, one-tap call and directions.
- Check in (captures location), then log the outcome, products discussed, samples given with quantities, the doctor's interest, order value, notes and a follow-up date.
- **Photographs of the call** — the clinic front, a prescription pad, a visiting card. Taken with the phone camera from inside the visit, up to eight per call, downscaled on the phone so the upload is quick on mobile data. They can be added after the visit is closed, for the rep who remembers on the way out.
- **Photos delete themselves 30 days after they are added.** Not a job somebody has to remember to run: each photo is written with an expiry date and MongoDB removes it on its own, whether or not the application is up. Nothing is served past that date even in the minute before the sweep, and the visit, its remarks and its samples stay for good.
- If the doctor gives a different call timing, the rep corrects it on the spot — future route plans use it immediately.

**Billing**
- Raise a bill for the products a buyer has taken, as either a **tax invoice** with GST or a **bill of supply** without it.
- **Anyone can be billed, not only doctors.** A doctor from the visiting directory, a trade buyer from the customer directory — stockist, distributor, chemist, hospital, clinic, institution or individual — or a one-off buyer typed straight onto the bill and never filed. Trade buyers live in **Admin → Customers** with their own GSTIN, state, credit period and drug licence, so the second bill for a stockist needs no retyping.
- A discount on every line, as a percentage or a flat amount, taken off before tax as it must be.
- GST worked out per line and summarised by HSN code: CGST and SGST within your state, IGST outside it, decided by the place of supply. Rates can be entered with tax already inside them.
- Bill numbers run `BHX/2025-26/0001` and restart each financial year.
- Every bill names the **representative it belongs to**, when the money is due, and when to follow up.
- **Part payments**: record each receipt as it comes in, by cash, UPI, cheque, card or transfer. The balance and the status follow from the receipts, so removing one entered by mistake corrects the bill by itself.
- **Your payment details and QR print on every bill.** Account name, bank, account number, IFSC, branch, UPI ID and a payment QR uploaded once under **Admin → Billing → Settings**, so a doctor can scan and pay without asking how.
- **Proof of every receipt.** A UPI screenshot, a photograph of a cheque or a bank advice as PDF, attached the moment the payment is recorded — the phone taking the payment is the one holding the evidence — or afterwards from the bill. A rep may correct their own; only an administrator replaces somebody else's, because evidence anyone can quietly swap proves nothing. Removing a receipt takes its proof with it.
- Reps see their own bills on their phone, collect against them, and **download any of them as a PDF**.
- Raised in error? Cancel keeps the number in the books; delete is available only before anything has been received.

**Inventory**
- **One pool per product.** Each product carries a units-available figure set from **Admin → Products**. Samples issued to a representative and products billed to a doctor come out of that same figure, because in the storeroom they come out of the same box.
- The figure is never stored on the product itself — it is the balance of the stock ledger, so typing a new count records the difference as a correction and the number can never disagree with the events behind it.
- Company stock per product: opening stock, receipts from suppliers with batch and expiry, sales returns and stocktake corrections.
- Billing a doctor takes the goods off the shelf. Issuing samples to a rep does too — the same units cannot be counted twice.
- Cancelling or deleting a bill puts its goods back.
- Reorder levels flag what is running low, and anything that has gone below zero is shown rather than hidden.

**HR**
- A desk of its own at **Admin → People**: who is in, who is off, and what is waiting on a decision.
- **Employment records** — designation, department, joining date, reporting line, emergency contact, PAN and bank details. Only the last four digits of an Aadhaar number are ever stored.
- **Attendance** as a month grid, one row per person. Most of it fills itself in: a completed visit means the rep was out working, approved leave marks itself, and company holidays apply to everybody — so only the exceptions are marked by hand. An unmarked day stays visibly blank rather than counting as an absence.
- **Leave** — reps apply from their phone, HR approves or refuses, and balances come off the requests themselves. Overlapping requests and requests beyond the balance are refused when they are made, not after two approvals have spent it twice. Nobody can sign off their own leave.
- A **holiday calendar** that excludes those days from everybody's working days.
- **Employment records that follow a career** — standing (probation, confirmed, notice, exited), confirmation date, last working day and reason for leaving, alongside UAN, ESIC number and bank details. Somebody who leaves is recorded with a leaving date, never erased: their payroll history has to stay whole.

**Payroll and payslips**
- **A salary is a series of revisions, not a figure that gets edited.** Each carries the month it takes effect from, so a raise in July leaves June's payslip saying exactly what June paid, and "what were they earning last March" is a question with an answer.
- Basic, HRA, conveyance, medical and special allowance, plus any allowance of the company's own. Standing recoveries — a salary advance, a loan instalment — and the employee's declared monthly TDS sit beside them.
- **The month builds itself from the attendance already there.** A completed visit already marks a rep present, approved leave marks itself, and holidays apply to everybody — so payroll reads the same sheet rather than asking anybody to type the month twice.
- **Loss of pay is only what somebody has actually said.** An absence costs a day and so does unpaid leave; approved paid leave costs nothing, and neither does half a day of it, because the other half was worked. A day nobody has marked is **not** an absence — an unmarked sheet must never dock a rep's salary.
- **Joiners and leavers settle themselves.** Somebody who joined on the 18th is paid for thirteen days, somebody whose last day was the 9th for nine — divided by the whole month, which is what pro-rating means.
- **Statutory deductions worked out properly** — provident fund at 12% of the basic actually paid, to the ₹15,000 ceiling or the whole basic where the company has agreed to that; ESI at 0.75% where the wage is within ₹21,000, with eligibility decided by the full salary so a month of leave cannot sweep somebody into the scheme; professional tax from **slabs you set**, because it is state law that changes on a state's own timetable and does not belong in code.
- The employer's own contributions — the fund, the pension share, ESI, a gratuity provision — are **set out and never deducted**, so cost to company is honest and an employee can see what is paid on their behalf.
- Every earning line is rounded and then summed, never the other way round, so **the parts of a payslip always add up to its total**.
- **Prepared, approved, then paid.** A draft can be rebuilt as often as attendance is corrected; approval freezes the figures; a paid month cannot be reopened, because money that has left the bank is corrected by a later entry rather than by rewriting the month it left in.
- **HR prepares the month; the administrator approves it.** One person able to both raise the figures and release them is the oldest hole in any set of books.
- **Nobody is left out quietly.** Anybody the run cannot pay — no salary set, not on the rolls — is listed with the reason, on the preview before you commit and on the month afterwards.
- Reps see **their own payslips** on their phone under **More**, once the month is approved, and print any of them as a PDF. A payslip carries the employment record as it stood on the day it was issued, so it still reads correctly after a transfer, a raise or a change of bank — and shows only the last four digits of the account.

**Admin tracking**
- Every visit with its outcome, samples, notes and the photographs taken at it.
- **A field record for each representative** at **Admin → Employees → Field activity**, over 7, 30 or 90 days or everything on record: how many doctors they met, visits completed and missed, completion rate, samples handed out and order value.
  - **Every doctor they visited** — how many times, when they were last seen, the last outcome, the doctor's interest, samples given and orders taken.
  - **Every visit in full** — the remarks the rep wrote, what was discussed, what was handed over, the follow-up date, where they checked in on a map, and the photos still held.
  - **Everything they changed** — doctors added, call times corrected, visits checked into, completed and missed, photos attached and removed, in the order it happened. Kept as its own trail because a record only ever shows its latest state: a call time corrected three times looks exactly like one corrected once.
- The employment record and the field record are separate screens. HR keeps the first; a rep's call notes are the administrator's alone to read.
- Reports: completion rate per representative, sample distribution by product, visit outcomes and doctor interest.

## Roles

| | Admin | HR | MR | Field sales |
|---|:---:|:---:|:---:|:---:|
| Doctor directory and discovery | ✓ | | | |
| Route planning and assignment | ✓ | | | |
| Reports | ✓ | | | |
| Employee management | ✓ | ✓ | | |
| Attendance, leave approval and holidays | ✓ | ✓ | | |
| Set a salary and prepare a payroll month | ✓ | ✓ | | |
| Approve payroll and release the money | ✓ | | | |
| Read somebody else's salary and payslips | ✓ | ✓ | | |
| Read their own payslips | ✓ | ✓ | ✓ | ✓ |
| Add a doctor to the directory | ✓ | | ✓ | ✓ |
| Plan their own round | | | ✓ | ✓ |
| Apply for leave | ✓ | ✓ | ✓ | ✓ |
| Raise, cancel and edit bills | ✓ | | | |
| Customer directory (stockists, distributors) | ✓ | | | |
| Read every bill and what is owed | ✓ | ✓ | | |
| Inventory: receive stock and correct counts | ✓ | | | |
| Own daily route and visits | | | ✓ | ✓ |
| Attach photos to their own visit | | | ✓ | ✓ |
| Read a representative's field record | ✓ | | | |
| Own bills: collect payment and download | | | ✓ | ✓ |
| Update a doctor's call time | ✓ | | ✓ | ✓ |

Admin and HR use the desktop panel at `/admin`; MR and Sales use the mobile panel at `/employee`. Middleware keeps each role in its own panel, and every API route re-checks permission on the server — the UI never decides access on its own.

**Sales affiliates are not in this table, and not in this staff register.** The affiliate business — strangers who sell online with a coupon code and take a share of what arrives — is a separate CRM with a separate panel of its own at `/partner`, where a rep signs up, creates their own coupon code once approved, follows every order it brings in, and sees what they are owed. Those orders are also **sent from inside the CRM**: **Sales CRM → Process orders** books the parcel with Shiprocket, chooses the courier by rule or by name out of what actually reaches that pin code, and prints the invoices and labels — one order or forty at a time, instead of a second browser tab open on Shiprocket's own panel all morning. They have no employee id, never appear in the HR screens and cannot be paid by payroll; their sign-in is a different cookie with its own audience, so no affiliate can reach `/admin` or `/employee` and no employee can reach `/partner`. See `docs/SALES-CRM-SETUP.md`.

Bills and payslips live outside both panels, at `/invoices/…/print` and `/payslips/…/print`, so one link serves a desk and a phone. They are guarded for a valid session, and the page itself decides who may open that particular document — a rep gets their own and nobody else's.

## Setup

1. Node.js 20+ and a MongoDB database.
2. Copy `.env.example` to `.env.local` and fill it in.
3. `npm install`
4. `npm run seed`
5. `npm run dev`, then open `http://localhost:3000/login`

The seed creates one administrator: `admin@bhealix.com` / `Bhealix@123`. **Change the password before going live.** Representatives are added from the Team screen; pass `SEED_DEMO_STAFF=1` if you want throwaway MR/HR/Sales accounts for a demo.

No sample doctors or products are created. Product names appear in sample-distribution reports, so the catalogue starts empty and is filled from **Admin → Products** with the real range. Give each product its selling rate, HSN code and GST slab there — a bill is then raised by choosing a product and typing a quantity.

Before the first tax invoice, fill in **Admin → Billing → Settings** with your GSTIN, your state and your bank details. Your state is what decides CGST + SGST against IGST. Without a GSTIN the app will still raise bills, but only as a bill of supply with no GST charged. Then record what you already hold from **Admin → Inventory**, so stock counts down correctly from the first bill.

`npm run seed` is safe to re-run against real data: it never deletes doctors, never resets an existing password, and migrates call timings from the older `mrcallschedules` collection into each doctor record.

## Removing records

- **Doctors** are archived rather than deleted, so past visits still make sense.
- **Route plans** can be deleted from the plans list or a plan's page. Completed visits are kept; visits still waiting to happen go with the plan.
- **Employees** can be deactivated (keeps their history, blocks sign-in) or deleted. Deletion is refused for anyone with recorded visits, and for the last remaining administrator.
- **Products** are deleted outright if never used, and retired instead once a visit references them, so past sample figures stay accurate.

## Google Maps setup

Enable **Places API (New)** and **Geocoding API**, then set `GOOGLE_MAPS_SERVER_API_KEY`. Restrict the key to those two APIs.

A wide-radius search covers ground by querying a ring of sub-centres and merging results by Place ID, because one Places call only returns about 20 results near a single point. Google does not publish an email for most clinics and often no phone — those fields show "Not available" rather than being invented.

## Commands

```bash
npm run dev        # development server
npm run seed       # accounts, products, and call-time migration
npm run icons      # redraw the PWA icons from the brand mark
npm run typecheck
npm run lint
npm test
npm run build
```

## Installing it as an app

The site is a PWA, so reps can add it to a home screen and get a full-screen app with no browser chrome. Android and desktop Chrome show an install card on the field panel; iOS needs Share → Add to Home Screen, and the same card says so. Dismissing it hides it for 30 days.

The service worker (`public/sw.js`) is deliberately conservative. It caches build output and icons only — never `/api` responses and never page HTML, because both are per-user and phones get shared. So **the app does not work offline**: losing coverage shows a banner, and a navigation with no connection lands on `public/offline.html` instead of an error page. Making visits work offline would need a local write queue, which is a separate piece of work.

New deploys do not take over a page mid-form. The waiting worker sits idle and a "new version is ready" banner appears; the swap happens when the rep taps it. Bump `VERSION` in `public/sw.js` to force every cache to be dropped on the next release.

Icons are generated from the `<BrandMark />` heart by `npm run icons` and committed under `public/icons/`.

## How the route ordering works

`src/lib/routing.ts`. From the starting doctor the planner repeatedly looks at every doctor not yet visited, works out when the meeting could actually begin given travel time and that doctor's call window, and takes whoever can be seen soonest — breaking ties by distance so nearby doctors sharing a window stay together. Waiting for a window to open is allowed; arriving after it closes is not, and those stops are reported as conflicts.

This is a greedy heuristic, not a proven optimum. It will occasionally leave a doctor unreachable when a different order would have fitted everyone. It always says so rather than quietly scheduling an impossible visit, and the fix is usually an earlier start, shorter visits, or moving that doctor to another day.

Travel time is estimated from straight-line distance at 25 km/h, so it is a planning aid, not live traffic.

## Known limitations

- Google Places cannot guarantee every doctor in an area, and rarely provides email addresses.
- Doctors need latitude and longitude to appear in a route plan. Google-sourced records have them; manually added ones need coordinates entered.
- Password reset is administrator-assisted; there is no reset email until a mail provider is configured.
- Excel import runs inline, so very large sheets are best split.

## Deployment

Deploy to Vercel with MongoDB Atlas. Set every environment variable in the Vercel project, rotate the seed passwords, restrict the Google key to your production APIs, lock down the Atlas network access list, and run `npm run build` before release. Never commit `.env.local`.

### Keep the functions and the database in the same city

`vercel.json` pins the functions to `bom1` (Mumbai) because that is where the
Atlas cluster is. This is not a preference — it is the single largest thing
governing how fast the application feels.

Vercel defaults to `iad1` in Washington DC. Left at the default, every query
crosses the Atlantic and the Indian Ocean twice: measured at the cluster, a
round trip costs about 220 ms, against roughly 1 ms from inside Mumbai. Nothing
in this codebase does only one query — a bill listing populates a doctor, a
customer and an employee, and each populate is its own round trip — so the
default region put the better part of a second into every screen before a line
of application code ran. The users are in India too, so the same move shortens
the browser's leg of the journey as well.

**If the cluster is ever moved, move this with it.** A mismatch between the two
is invisible in every log and profiler; it simply makes everything slow.
