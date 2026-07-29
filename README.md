# BHEALIX Doctor CRM

Mobile-first doctor discovery, relationship management, MR scheduling, assignments and field-visit application for BHEALIX.

## Stack and architecture

Next.js App Router, strict TypeScript, Tailwind CSS, MongoDB/Mongoose, signed HTTP-only JWT sessions, Zod, bcrypt, Google Maps Platform, SheetJS, Recharts and Vitest. Pages call protected Next.js route handlers; server models and secrets never enter client bundles. MongoDB connections are reused for serverless deployment.

Core models include User, Doctor, Clinic, Territory, Product, MrCallSchedule, Assignment, Visit, FollowUp, Order, SavedSearch, AuditEvent and AppSetting. Doctor and Clinic locations use GeoJSON `[longitude, latitude]` with `2dsphere` indexes.

## Setup

1. Use Node.js 20+ and create a MongoDB Atlas database.
2. Copy `.env.example` to `.env.local` and configure MongoDB, random 32+ character secrets and Google keys.
3. Run `npm install`.
4. Run `npm run seed`.
5. Run `npm run dev` and open `http://localhost:3000/login`.

Development Admin: `admin@bhealix.test` / `Bhealix@123`. MR, HR and Sales accounts use `mr@bhealix.test`, `mr2@bhealix.test`, `hr@bhealix.test`, and `sales@bhealix.test` with the same password. Never retain these credentials in production.

## Google Cloud setup

Enable Places API (New), Geocoding API, Maps JavaScript API and Routes API. Use separate keys:

- Browser key: restrict to your local and production HTTP referrers; enable Maps JavaScript only.
- Server key: restrict by server environment where supported; enable Places and Geocoding only.

Set `GOOGLE_MAPS_SERVER_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Large-radius discovery uses multiple search centres, merges by Google Place ID, calculates real distance and enforces a maximum of 100 km. Google coverage is not guaranteed to be exhaustive, and missing contact data is never fabricated.

## Excel workflow

Admin can import `.xlsx`, `.xls` or `.csv` files up to 5 MB. Rows are validated, duplicates are checked by code or doctor/clinic identity, invalid rows are reported, and valid records are saved. Export produces a current non-archived doctor workbook. Use headings such as Doctor Name, Doctor Code, Specialty, Clinic Name, Mobile Number, Area, City, Priority and Lead Status.

## Roles

- ADMIN: full management, discovery, imports/exports, reporting and settings.
- MR: assigned doctors, field visits, notes, follow-ups and interests.
- SALES: assigned doctors, opportunities, orders and area activity.
- HR: employee management and basic visit activity; no confidential commercial fields.

Middleware protects both panels and APIs. APIs additionally enforce ownership for visit check-in/out. Passwords use bcrypt cost 12; session cookies are HTTP-only, SameSite Lax and Secure in production.

## Commands

```bash
npm run dev
npm run seed
npm run typecheck
npm run lint
npm test
npm run build
```

## Deployment

Deploy to Vercel with MongoDB Atlas. Configure all production environment variables in Vercel, rotate seed credentials, restrict Google keys to production domains/APIs, restrict Atlas network/database users, and run the production build before release. Do not commit `.env.local`.

## Troubleshooting

- Login failure: run `npm run seed`, confirm `AUTH_SECRET`, then clear old cookies.
- Empty Google search: configure the server key and confirm Places API (New) and Geocoding billing/access.
- Atlas timeout: verify the database user, password, IP access list and URI database name.
- Old routes after edits: stop the dev server, remove `.next`, and restart.

## Genuine limitations

Google Places cannot guarantee every doctor or private phone number. The current import executes validated rows immediately rather than maintaining a long-running background import job. Production password email delivery requires an email provider; without one, password recovery is administrator-assisted. Object-storage-backed photos require a configured storage provider.
