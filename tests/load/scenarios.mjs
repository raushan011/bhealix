/**
 * What the load actually consists of.
 *
 * Weighted towards reading, because that is what a CRM day looks like: a rep
 * opens their round, scrolls the doctor list, opens a few records, and writes
 * comparatively rarely. A load test made only of the cheapest endpoint measures
 * nothing useful, and one made only of writes measures a database import.
 *
 * `read`-only profiles exist so a run can be pointed at an environment where
 * creating records is not acceptable.
 */

const oneOf = (list, random) => list[Math.floor(random() * list.length)];

/** Reads: safe to run anywhere, including against an environment with real data. */
export const READ_SCENARIOS = [
  {
    name: "doctors:list",
    weight: 10,
    run: (client, { random }) => client.get(`/api/doctors?page=${1 + Math.floor(random() * 5)}&limit=20`)
  },
  {
    name: "doctors:search",
    weight: 4,
    run: (client, { random }) => client.get(`/api/doctors?q=${oneOf(["Test", "Clinic", "Doctor", "Mumbai"], random)}`)
  },
  {
    name: "doctors:detail",
    weight: 6,
    run: (client, { doctorIds, random }) => client.get(`/api/doctors/${oneOf(doctorIds, random)}`)
  },
  {
    name: "doctors:map",
    weight: 2,
    // Returns every located doctor in one payload — the heaviest read in the app.
    run: client => client.get("/api/doctors/locations")
  },
  {
    name: "visits:list",
    weight: 8,
    run: client => client.get("/api/visits?limit=20")
  },
  {
    name: "plans:list",
    weight: 3,
    run: client => client.get("/api/plans?limit=20")
  },
  {
    name: "invoices:list",
    weight: 4,
    run: client => client.get("/api/invoices?limit=20")
  },
  {
    name: "samples:stock",
    weight: 3,
    run: client => client.get("/api/samples/stock")
  },
  {
    name: "products:list",
    weight: 2,
    run: client => client.get("/api/products?limit=20")
  },
  {
    name: "hr:leave",
    weight: 2,
    run: client => client.get("/api/hr/leave?limit=20")
  },
  {
    name: "auth:me",
    weight: 2,
    run: client => client.get("/api/auth/me")
  }
];

/**
 * Writes, for a profile pointed at a throwaway database.
 *
 * Registering a visit is the write a rep actually makes in the field, and it is
 * deliberately idempotent per doctor per day — so under load most of these
 * return the existing visit rather than creating a new one. That is realistic:
 * it exercises the duplicate check, which is the expensive part.
 */
export const WRITE_SCENARIOS = [
  {
    name: "visits:register",
    weight: 3,
    run: (client, { doctorIds, random }) =>
      client.post("/api/visits", { doctor: oneOf(doctorIds, random), notes: "load test" })
  },
  {
    name: "leave:apply",
    weight: 1,
    run: (client, { random }) => client.post("/api/hr/leave", {
      type: "Casual",
      from: `2031-0${1 + Math.floor(random() * 9)}-01`,
      to: `2031-0${1 + Math.floor(random() * 9)}-02`,
      reason: "load test"
    })
  }
];

export const MIXED_SCENARIOS = [...READ_SCENARIOS, ...WRITE_SCENARIOS];

/** The login path on its own — bcrypt at cost 12 makes it the most expensive route in the app. */
export const LOGIN_SCENARIOS = [
  {
    name: "auth:login",
    weight: 1,
    run: async (client, { accounts, random }) => {
      const { Client } = await import("../support/client.mjs");
      const fresh = new Client();
      const account = oneOf(accounts, random);
      return fresh.post("/api/auth/login", { identifier: account, password: client.password });
    }
  }
];
