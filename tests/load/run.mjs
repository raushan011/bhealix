/**
 * Runs a load profile and prints the result.
 *
 *   node tests/load/run.mjs                    smoke
 *   node tests/load/run.mjs load
 *   node tests/load/run.mjs stress --scale 2
 *   node tests/load/run.mjs spike --json out.json
 *
 * Signs in once per role before the clock starts, so the cost of bcrypt does
 * not land inside the measurement — except in the `login` profile, where it is
 * the thing being measured.
 */
import fs from "node:fs";
import { runStage } from "./engine.mjs";
import { PROFILES, THRESHOLDS } from "./profiles.mjs";
import { READ_SCENARIOS, WRITE_SCENARIOS, MIXED_SCENARIOS, LOGIN_SCENARIOS } from "./scenarios.mjs";
import { as, waitForServer } from "../support/client.mjs";
import { assertSafeTarget, BASE_URL, ACCOUNTS, TEST_PASSWORD } from "../support/config.mjs";
import { fixtures } from "../support/fixtures.mjs";

const argv = process.argv.slice(2);
const profileName = argv.find(arg => !arg.startsWith("--")) ?? "smoke";
const flag = name => {
  const index = argv.indexOf(`--${name}`);
  return index > -1 ? argv[index + 1] : undefined;
};

const profile = PROFILES[profileName];
if (!profile) {
  console.error(`Unknown profile "${profileName}". Available: ${Object.keys(PROFILES).join(", ")}`);
  process.exit(1);
}

const scale = Number(flag("scale") ?? 1);
const jsonOut = flag("json");

const MIXES = {
  read: READ_SCENARIOS,
  write: WRITE_SCENARIOS,
  mixed: MIXED_SCENARIOS,
  login: LOGIN_SCENARIOS
};

// A write mix creates records; only a throwaway database may take it.
assertSafeTarget({ destructive: profile.mix !== "read" });

const ms = value => `${value.toFixed(0)} ms`.padStart(9);
const pct = value => `${(value * 100).toFixed(2)}%`;

function printStage(label, result) {
  const { overall } = result;
  console.log(
    `\n  ${label}  —  ${result.users} users, ${(result.elapsedMs / 1000).toFixed(0)}s\n` +
    `    requests ${String(result.requests).padStart(6)}   ` +
    `throughput ${result.throughput.toFixed(1).padStart(6)}/s   ` +
    `errors ${pct(result.errorRate).padStart(7)}\n` +
    `    p50 ${ms(overall.p50)}   p90 ${ms(overall.p90)}   ` +
    `p95 ${ms(overall.p95)}   p99 ${ms(overall.p99)}   max ${ms(overall.max)}`
  );

  const failing = Object.entries(result.scenarios)
    .filter(([, stats]) => stats.failed > 0)
    .sort((a, b) => b[1].failed - a[1].failed);

  if (failing.length) {
    console.log("    failures:");
    for (const [name, stats] of failing) {
      const codes = Object.entries(stats.statuses)
        .filter(([code]) => code === "0" || Number(code) >= 500 || Number.isNaN(Number(code)))
        .map(([code, count]) => `${code}×${count}`)
        .join(" ");
      console.log(`      ${name.padEnd(20)} ${stats.failed} failed   ${codes}`);
    }
  }
}

function printSlowest(result) {
  const rows = Object.entries(result.scenarios)
    .filter(([, stats]) => stats.count)
    .sort((a, b) => b[1].p95 - a[1].p95)
    .slice(0, 6);

  console.log("\n    slowest endpoints by p95:");
  for (const [name, stats] of rows) {
    console.log(`      ${name.padEnd(20)} p50 ${ms(stats.p50)}  p95 ${ms(stats.p95)}  n=${stats.count}`);
  }
}

// ---------------------------------------------------------------------- run

console.log(`\n  profile   ${profileName} — ${profile.description}`);
console.log(`  target    ${BASE_URL}`);
if (scale !== 1) console.log(`  scale     ×${scale}`);

await waitForServer(BASE_URL);

const ids = fixtures();
const scenarios = MIXES[profile.mix];

/**
 * One signed-in client per field account, plus the desk.
 *
 * Several sessions rather than one, so the virtual users are not all the same
 * person: a single session would make every ownership filter hit the same
 * subset of data and the query plans would be unrealistically warm.
 */
const clients = profile.mix === "login"
  ? [Object.assign(await as("ADMIN"), { password: TEST_PASSWORD })]
  : await Promise.all([as("MR"), as("MR2"), as("SALES"), as("ADMIN"), as("HR")]);

const context = {
  doctorIds: ids.doctorIds,
  accounts: Object.values(ACCOUNTS).map(account => account.email)
};

const stages = [];
for (const [index, stage] of profile.stages.entries()) {
  const label = stage.label ?? `stage ${index + 1}`;
  process.stdout.write(`\n  running ${label} (${stage.users} users)…`);

  const result = await runStage({
    scenarios,
    clients,
    users: stage.users,
    durationMs: stage.durationMs * scale,
    thinkTimeMs: profile.thinkTimeMs,
    seed: 1000 + index,
    context
  });

  process.stdout.write("\r".padEnd(60) + "\r");
  printStage(label, result);
  stages.push({ label, ...result });
}

const lastStage = stages[stages.length - 1];
printSlowest(lastStage);

// ------------------------------------------------------------------ verdict

const totals = stages.reduce(
  (sum, stage) => ({
    requests: sum.requests + stage.requests,
    failed: sum.failed + stage.failed
  }),
  { requests: 0, failed: 0 }
);
const errorRate = totals.requests ? totals.failed / totals.requests : 0;
const worstP95 = Math.max(...stages.map(stage => stage.overall.p95));

const threshold = THRESHOLDS[profileName] ?? {};
const breaches = [];
if (threshold.errorRate !== undefined && errorRate > threshold.errorRate) {
  breaches.push(`error rate ${pct(errorRate)} exceeds ${pct(threshold.errorRate)}`);
}
if (threshold.p95 !== undefined && worstP95 > threshold.p95) {
  breaches.push(`worst p95 ${worstP95.toFixed(0)} ms exceeds ${threshold.p95} ms`);
}

console.log(
  `\n  ${"─".repeat(60)}\n` +
  `  total ${totals.requests} requests, ${totals.failed} failed (${pct(errorRate)}), worst p95 ${worstP95.toFixed(0)} ms`
);

/**
 * Where latency turned upward. On a ramp this is the capacity figure — the last
 * step before p95 doubled — and it is far more useful than the biggest number.
 */
if (stages.length > 1) {
  const knee = stages.find((stage, index) =>
    index > 0 && stage.overall.p95 > stages[index - 1].overall.p95 * 2);
  if (knee) {
    const previous = stages[stages.indexOf(knee) - 1];
    console.log(
      `  knee: p95 more than doubled between ${previous.users} and ${knee.users} users ` +
      `(${previous.overall.p95.toFixed(0)} → ${knee.overall.p95.toFixed(0)} ms)`
    );
  } else {
    console.log(`  no knee found — latency stayed proportionate to the last stage tested`);
  }
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ profile: profileName, target: BASE_URL, stages }, null, 2));
  console.log(`  written to ${jsonOut}`);
}

if (breaches.length) {
  console.log(`\n  FAILED\n${breaches.map(breach => `    · ${breach}`).join("\n")}\n`);
  process.exit(1);
}
console.log(`\n  PASSED — within thresholds for "${profileName}"\n`);
