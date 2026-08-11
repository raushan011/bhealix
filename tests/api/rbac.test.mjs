/**
 * Who may call what, checked as a matrix across every API route.
 *
 * The table below is written from `src/constants/access.ts` and the guard on
 * each handler, by hand and on purpose. Deriving it from the same `can` object
 * the app uses would make the test agree with the code by construction and
 * catch nothing — the point is to state the intended policy independently, so
 * that a guard being loosened shows up as a failure rather than as a matching
 * change on both sides.
 *
 * Every route is asserted twice over: an anonymous caller must get 401, and a
 * role outside the allow-list must get 403. What a permitted role gets back is
 * left to the suites that know the shape of each endpoint; here it only has to
 * be "not a refusal".
 */
import { describe, it, expect, beforeAll } from "vitest";
import { as, anonymous } from "../support/client.mjs";
import { fixtures, MISSING_ID } from "../support/fixtures.mjs";

const ALL = ["ADMIN", "HR", "MR", "SALES"];
const DESK = ["ADMIN", "HR"];
const FIELD = ["MR", "SALES"];
const ADMIN_ONLY = ["ADMIN"];
const ADMIN_AND_FIELD = ["ADMIN", "MR", "SALES"];

let ids;
const clients = {};

beforeAll(async () => {
  ids = fixtures();
  for (const role of ALL) clients[role] = await as(role);
});

/**
 * The matrix. `allow` is who the policy intends to let through; everyone else
 * must be refused with 403.
 *
 * Bodies are deliberately minimal and often invalid — a role that is refused
 * must be refused before the body is ever looked at, so a 400 coming back from
 * a permitted role is a pass here, and a 400 from a forbidden one is a bug
 * (validation ran before the authorisation check).
 */
const ROUTES = [
  // ------------------------------------------------------------------ auth
  { method: "GET", path: "/api/auth/me", allow: ALL },

  // --------------------------------------------------------------- doctors
  { method: "GET", path: "/api/doctors", allow: ALL },
  { method: "POST", path: "/api/doctors", allow: ADMIN_AND_FIELD, body: {} },
  { method: "GET", path: "/api/doctors/locations", allow: ALL },
  { method: "GET", path: "/api/doctors/export", allow: ADMIN_ONLY },
  { method: "POST", path: "/api/doctors/bulk", allow: ADMIN_AND_FIELD, body: {} },
  { method: "GET", path: "/api/doctors/:doctorId", allow: ALL },
  { method: "PATCH", path: "/api/doctors/:doctorId", allow: ADMIN_ONLY, body: {} },
  { method: "DELETE", path: "/api/doctors/:missing", allow: ADMIN_ONLY },
  { method: "PUT", path: "/api/doctors/:doctorId/call-schedule", allow: ADMIN_AND_FIELD, body: {} },

  // ---------------------------------------------------------------- google
  { method: "POST", path: "/api/google/doctors", allow: ADMIN_ONLY, body: {} },
  { method: "POST", path: "/api/google/lookup", allow: ADMIN_AND_FIELD, body: {} },
  { method: "GET", path: "/api/google/reverse?lat=19&lng=72", allow: ALL },

  // -------------------------------------------------------------- products
  { method: "GET", path: "/api/products", allow: ALL },
  { method: "POST", path: "/api/products", allow: ADMIN_ONLY, body: {} },
  { method: "PATCH", path: "/api/products/:productId", allow: ADMIN_ONLY, body: {} },
  { method: "DELETE", path: "/api/products/:missing", allow: ADMIN_ONLY },

  // ---------------------------------------------------------------- visits
  { method: "GET", path: "/api/visits", allow: ALL },
  // Only field staff register their own calls; the desk is refused by the handler.
  { method: "POST", path: "/api/visits", allow: FIELD, body: {} },
  { method: "PATCH", path: "/api/visits/:missing", allow: ALL, body: {} },
  { method: "GET", path: "/api/visits/:missing/photos", allow: ALL },

  // ----------------------------------------------------------------- plans
  { method: "GET", path: "/api/plans", allow: ALL },
  { method: "POST", path: "/api/plans", allow: ALL, body: {} },
  { method: "POST", path: "/api/plans/preview", allow: ADMIN_AND_FIELD, body: {} },
  { method: "GET", path: "/api/plans/:missing", allow: ALL },
  { method: "PUT", path: "/api/plans/:missing", allow: ADMIN_ONLY, body: {} },
  { method: "PATCH", path: "/api/plans/:missing", allow: ADMIN_ONLY, body: {} },
  { method: "DELETE", path: "/api/plans/:missing", allow: ADMIN_ONLY },

  // --------------------------------------------------------------- billing
  { method: "GET", path: "/api/invoices", allow: ALL },
  { method: "POST", path: "/api/invoices", allow: ADMIN_ONLY, body: {} },
  { method: "GET", path: "/api/invoices/:missing", allow: ALL },
  { method: "PUT", path: "/api/invoices/:missing", allow: ADMIN_ONLY, body: {} },
  { method: "PATCH", path: "/api/invoices/:missing", allow: ADMIN_ONLY, body: {} },
  { method: "DELETE", path: "/api/invoices/:missing", allow: ADMIN_ONLY },
  { method: "POST", path: "/api/invoices/:missing/payments", allow: ADMIN_AND_FIELD, body: {} },
  { method: "DELETE", path: "/api/invoices/:missing/payments", allow: ADMIN_ONLY },
  // Scheduling a chase moves no figure on the bill, so the rep who agreed the
  // date with the doctor may write it down — on their own bills, which the
  // handler checks for itself.
  { method: "POST", path: "/api/invoices/:missing/follow-ups", allow: ADMIN_AND_FIELD, body: {} },
  { method: "PATCH", path: "/api/invoices/:missing/follow-ups", allow: ADMIN_AND_FIELD, body: {} },
  { method: "DELETE", path: "/api/invoices/:missing/follow-ups", allow: ADMIN_AND_FIELD },
  { method: "GET", path: "/api/billing/settings", allow: ALL },
  { method: "PUT", path: "/api/billing/settings", allow: ADMIN_ONLY, body: {} },
  { method: "GET", path: "/api/billing/settings/qr", allow: ALL },
  { method: "DELETE", path: "/api/billing/settings/qr", allow: ADMIN_ONLY },

  // ------------------------------------------------------------- customers
  // The buyer directory is a desk matter: the handler checks `viewAllBilling`
  // itself, after a bare session guard.
  { method: "GET", path: "/api/customers", allow: DESK },
  { method: "POST", path: "/api/customers", allow: ADMIN_ONLY, body: {} },
  { method: "GET", path: "/api/customers/:missing", allow: DESK },
  { method: "PATCH", path: "/api/customers/:missing", allow: ADMIN_ONLY, body: {} },
  { method: "DELETE", path: "/api/customers/:missing", allow: ADMIN_ONLY },

  // ------------------------------------------------------------- inventory
  // The warehouse position is `viewAllStock` — field staff see their own bag
  // under Samples instead.
  { method: "GET", path: "/api/inventory/stock", allow: DESK },
  { method: "GET", path: "/api/inventory/movements", allow: DESK },
  { method: "POST", path: "/api/inventory/movements", allow: ADMIN_ONLY, body: {} },

  // --------------------------------------------------------------- samples
  { method: "GET", path: "/api/samples/stock", allow: ALL },
  { method: "GET", path: "/api/samples/movements", allow: ALL },
  { method: "POST", path: "/api/samples/movements", allow: ALL, body: {} },

  // ------------------------------------------------------------------ team
  { method: "GET", path: "/api/team", allow: ALL },
  { method: "POST", path: "/api/team", allow: DESK, body: {} },
  // The HR desk reads anybody's record; everybody else only their own — so the
  // MR passes on their own id and the SALES account must not.
  { method: "GET", path: "/api/team/:mrId", allow: [...DESK, "MR"] },
  { method: "PATCH", path: "/api/team/:mrId", allow: DESK, body: {} },
  { method: "DELETE", path: "/api/team/:missing", allow: DESK },

  // -------------------------------------------------------------------- HR
  { method: "GET", path: "/api/hr/overview", allow: DESK },
  { method: "GET", path: "/api/hr/attendance", allow: ALL },
  { method: "POST", path: "/api/hr/attendance", allow: DESK, body: {} },
  { method: "DELETE", path: "/api/hr/attendance?id=:missing", allow: DESK },
  { method: "GET", path: "/api/hr/holidays", allow: ALL },
  { method: "POST", path: "/api/hr/holidays", allow: DESK, body: {} },
  { method: "DELETE", path: "/api/hr/holidays?id=:missing", allow: DESK },
  { method: "GET", path: "/api/hr/leave", allow: ALL },
  { method: "POST", path: "/api/hr/leave", allow: ALL, body: {} },
  { method: "PATCH", path: "/api/hr/leave/:missing", allow: ALL, body: {} },
  { method: "DELETE", path: "/api/hr/leave/:missing", allow: ALL },

  // --------------------------------------------------------------- payroll
  { method: "GET", path: "/api/hr/payroll", allow: DESK },
  { method: "POST", path: "/api/hr/payroll", allow: DESK, body: {} },
  { method: "GET", path: "/api/hr/payroll/settings", allow: DESK },
  { method: "PUT", path: "/api/hr/payroll/settings", allow: DESK, body: {} },
  { method: "GET", path: "/api/hr/payroll/:missing", allow: DESK },
  // Preparing a run and releasing it are deliberately different authorities.
  { method: "PATCH", path: "/api/hr/payroll/:missing", allow: ADMIN_ONLY, body: {} },
  { method: "DELETE", path: "/api/hr/payroll/:missing", allow: ADMIN_ONLY },
  { method: "GET", path: "/api/hr/payslips", allow: ALL },
  { method: "POST", path: "/api/hr/payslips", allow: DESK, body: {} },
  // Everybody may read their own salary; reading somebody else's is `viewPayroll`.
  { method: "GET", path: "/api/hr/salary/:mrId", allow: [...DESK, "MR"] },
  { method: "POST", path: "/api/hr/salary/:mrId", allow: DESK, body: {} },
  { method: "DELETE", path: "/api/hr/salary/:mrId", allow: DESK },

  // --------------------------------------------------------------- reports
  { method: "GET", path: "/api/reports", allow: ADMIN_ONLY }
];

/**
 * Paths are written with tokens rather than as closures over the fixtures, so
 * the test name reads as the route it covers — `GET /api/doctors/:doctorId`
 * rather than the source text of an arrow function.
 */
const resolve = route => route.path.replace(/:(\w+)/g, (_, token) => {
  const value = {
    doctorId: () => ids.doctorIds[0],
    productId: () => ids.productIds[0],
    mrId: () => ids.users.MR,
    missing: () => MISSING_ID
  }[token];
  if (!value) throw new Error(`Unknown path token :${token}`);
  return value();
});

const label = route => `${route.method} ${route.path}`;

describe("every route refuses an anonymous caller", () => {
  for (const route of ROUTES) {
    it(label(route), async () => {
      const result = await anonymous().request(route.method, resolve(route), { body: route.body });
      expect(result.status, `expected 401, got ${result.status} — ${result.error ?? ""}`).toBe(401);
    });
  }
});

describe("every route refuses a role outside its policy", () => {
  for (const route of ROUTES) {
    const forbidden = ALL.filter(role => !route.allow.includes(role));
    if (!forbidden.length) continue;

    it(`${label(route)} — allowed: ${route.allow.join(", ")}`, async () => {
      for (const role of forbidden) {
        const result = await clients[role].request(route.method, resolve(route), { body: route.body });
        expect(result.status, `${role} on ${label(route)} expected 403, got ${result.status} — ${result.error ?? ""}`)
          .toBe(403);
      }
    });
  }
});

describe("every route admits the roles its policy allows", () => {
  for (const route of ROUTES) {
    it(`${label(route)} — ${route.allow.join(", ")}`, async () => {
      for (const role of route.allow) {
        const result = await clients[role].request(route.method, resolve(route), { body: route.body });
        // 400/404/409 are fine — the deliberately empty body did not validate,
        // or the record does not exist. Only a refusal is a failure.
        expect([401, 403], `${role} on ${label(route)} was refused (${result.status}) — ${result.error ?? ""}`)
          .not.toContain(result.status);
      }
    });
  }
});
