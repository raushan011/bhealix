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
- The rep opens the app to today's route in visiting order, with call times, addresses, one-tap call and directions.
- Check in (captures location), then log the outcome, products discussed, samples given with quantities, the doctor's interest, order value, notes and a follow-up date.
- If the doctor gives a different call timing, the rep corrects it on the spot — future route plans use it immediately.

**Admin tracking**
- Every visit with its outcome, samples and notes.
- Reports: completion rate per representative, sample distribution by product, visit outcomes and doctor interest.

## Roles

| | Admin | HR | MR | Sales |
|---|:---:|:---:|:---:|:---:|
| Doctor directory and discovery | ✓ | | | |
| Route planning and assignment | ✓ | | | |
| Reports | ✓ | | | |
| Employee management | ✓ | ✓ | | |
| Own daily route and visits | | | ✓ | ✓ |
| Update a doctor's call time | ✓ | | ✓ | ✓ |

Admin and HR use the desktop panel at `/admin`; MR and Sales use the mobile panel at `/employee`. Middleware keeps each role in its own panel, and every API route re-checks permission on the server — the UI never decides access on its own.

## Setup

1. Node.js 20+ and a MongoDB database.
2. Copy `.env.example` to `.env.local` and fill it in.
3. `npm install`
4. `npm run seed`
5. `npm run dev`, then open `http://localhost:3000/login`

The seed creates one administrator: `admin@bhealix.com` / `Bhealix@123`. **Change the password before going live.** Representatives are added from the Team screen; pass `SEED_DEMO_STAFF=1` if you want throwaway MR/HR/Sales accounts for a demo.

No sample doctors or products are created. Product names appear in sample-distribution reports, so the catalogue starts empty and is filled from **Admin → Products** with the real range.

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
