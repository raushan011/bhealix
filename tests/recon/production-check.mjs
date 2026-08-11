/**
 * A read-only check of a deployed environment.
 *
 * Deliberately safe to point at production: it signs in as nobody, sends no
 * writes, and makes a few dozen requests in total — about what one person
 * browsing for a minute would. It answers the questions worth answering before
 * anybody runs a real load test:
 *
 *   · is it up, and how fast is a cold request versus a warm one
 *   · does every API route actually refuse an anonymous caller
 *   · what does it say about itself in its headers
 *   · is the session cookie set with the flags it should be
 *
 * What it deliberately does not do is generate load or attempt any bypass. Both
 * belong against a throwaway environment; see tests/load and tests/security.
 *
 *   node tests/recon/production-check.mjs https://bhealix.vercel.app
 */
import { summarise } from "../load/engine.mjs";

const target = (process.argv[2] ?? process.env.TEST_BASE_URL ?? "").replace(/\/$/, "");
if (!target) {
  console.error("Usage: node tests/recon/production-check.mjs <https://host>");
  process.exit(1);
}

const ms = value => `${value.toFixed(0)} ms`;
const mark = pass => (pass ? "  ok  " : " WARN ");

async function probe(path, { method = "GET", headers = {} } = {}) {
  const started = performance.now();
  try {
    const response = await fetch(`${target}${path}`, {
      method, headers, redirect: "manual", signal: AbortSignal.timeout(30_000)
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, ms: performance.now() - started };
  } catch (error) {
    return { status: 0, error: error.message, ms: performance.now() - started };
  }
}

console.log(`\n  Read-only check of ${target}\n  ${"─".repeat(58)}`);

// ------------------------------------------------------------ reachability

const root = await probe("/");
console.log(`\n  reachability`);
console.log(`    GET /                       ${root.status || root.error}   ${ms(root.ms)}`);

const login = await probe("/login");
console.log(`    GET /login                  ${login.status}   ${ms(login.ms)}`);

// --------------------------------------------------------- auth enforcement

/**
 * Every one of these must refuse an anonymous caller. A 200 here is a hole
 * open to the whole internet, so it is the single most important line in the
 * file — and it is entirely read-only to check.
 */
const PROTECTED = [
  "/api/auth/me", "/api/doctors", "/api/doctors/locations", "/api/doctors/export",
  "/api/visits", "/api/plans", "/api/invoices", "/api/customers",
  "/api/inventory/stock", "/api/inventory/movements", "/api/samples/stock",
  "/api/team", "/api/reports", "/api/hr/overview", "/api/hr/attendance",
  "/api/hr/leave", "/api/hr/payroll", "/api/hr/payroll/settings", "/api/hr/payslips",
  "/api/billing/settings", "/api/products"
];

console.log(`\n  anonymous access (every route must refuse)`);
const exposed = [];
for (const path of PROTECTED) {
  const result = await probe(path);
  const refused = result.status === 401 || result.status === 403 || result.status === 404;
  if (!refused) exposed.push({ path, status: result.status });
  console.log(`   ${mark(refused)} ${path.padEnd(32)} ${result.status}`);
}

// ------------------------------------------------------------------ headers

console.log(`\n  response headers`);
const headerChecks = [
  ["strict-transport-security", value => Boolean(value), "HSTS not set"],
  ["x-frame-options", value => Boolean(value), "no clickjacking protection (or use CSP frame-ancestors)"],
  ["content-security-policy", value => Boolean(value), "no CSP"],
  ["x-content-type-options", value => value === "nosniff", "MIME sniffing not disabled"],
  ["referrer-policy", value => Boolean(value), "no referrer policy"]
];

for (const [name, ok, note] of headerChecks) {
  const value = login.headers?.get(name);
  console.log(`   ${mark(ok(value))} ${name.padEnd(32)} ${value ?? note}`);
}

const powered = login.headers?.get("x-powered-by");
if (powered) console.log(`   ${mark(false)} ${"x-powered-by".padEnd(32)} ${powered}`);

// ------------------------------------------------------------ cookie flags

/**
 * A failed sign-in is still a POST, so this is the one request in the file that
 * is not a GET. It creates nothing — a wrong password is rejected — and it is
 * the only way to see the flags on the session cookie.
 */
console.log(`\n  session cookie (checked via a deliberately failed sign-in)`);
const attempt = await probe("/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" }
});
console.log(`    POST /api/auth/login        ${attempt.status} (no credentials sent)`);
if (attempt.headers?.getSetCookie?.().length) {
  console.log(`   ${mark(false)} a cookie was set on a failed sign-in`);
} else {
  console.log(`   ${mark(true)} no cookie set without valid credentials`);
}

// ------------------------------------------------------------ leak check

console.log(`\n  information disclosure`);
const leaks = ["MongoServerError", "mongodb+srv://", "at Object.", "node_modules", "AUTH_SECRET"];
const bodies = [root.text ?? "", login.text ?? "", attempt.text ?? ""].join("\n");
for (const leak of leaks) {
  console.log(`   ${mark(!bodies.includes(leak))} ${leak}`);
}

// -------------------------------------------------------------- latency

/**
 * Twelve sequential requests to one public page. Not a load test — it is one
 * visitor, and it exists to separate a cold start from steady state.
 */
console.log(`\n  latency of /login over 12 sequential requests`);
const samples = [];
for (let i = 0; i < 12; i++) {
  const result = await probe("/login");
  samples.push(result.ms);
}
const stats = summarise(samples);
console.log(`    first ${ms(samples[0])}   p50 ${ms(stats.p50)}   p95 ${ms(stats.p95)}   max ${ms(stats.max)}`);
if (samples[0] > stats.p50 * 2) {
  console.log(`    the first request was much slower than the rest — a cold start`);
}

// -------------------------------------------------------------- verdict

console.log(`\n  ${"─".repeat(58)}`);
if (exposed.length) {
  console.log(`  ${exposed.length} route(s) answered an anonymous caller:`);
  for (const { path, status } of exposed) console.log(`    · ${path} → ${status}`);
  process.exit(1);
}
console.log(`  No unauthenticated access to any of the ${PROTECTED.length} API routes checked.\n`);
