/**
 * A closed-loop load generator.
 *
 * Written rather than pulled in because k6 is not installed here and needs a
 * system-level install, while autocannon drives one URL at a time and cannot
 * hold a signed-in session across a realistic mix of endpoints. This app
 * authenticates with a cookie and the interesting behaviour is the mix, so the
 * generator has to sign in as several people and keep their sessions.
 *
 * Closed-loop: each virtual user issues a request, waits for the answer, thinks
 * briefly, and goes again. That models people using an app. It does mean
 * throughput falls out of latency rather than being dialled in — under stress a
 * slow server produces fewer requests per second, not a growing queue — which
 * is the honest shape for a CRM with a few hundred users. An open-loop model
 * would keep arriving regardless and is the right choice for a public endpoint
 * facing the internet; it is not what these reps look like.
 */
import { performance } from "node:perf_hooks";

/**
 * Percentiles from raw samples.
 *
 * Kept as a full sample array rather than a streaming estimator: a run of this
 * size is a few hundred thousand numbers at worst, and an exact p99 is worth
 * more than the memory saved by approximating it.
 */
export function summarise(samples) {
  if (!samples.length) return null;
  const sorted = Float64Array.from(samples).sort();
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    count: sorted.length,
    min: sorted[0],
    mean: total / sorted.length,
    p50: at(0.5),
    p75: at(0.75),
    p90: at(0.9),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1]
  };
}

/** Picks a scenario according to its weight. */
function pick(scenarios, random) {
  const total = scenarios.reduce((sum, scenario) => sum + (scenario.weight ?? 1), 0);
  let target = random * total;
  for (const scenario of scenarios) {
    target -= scenario.weight ?? 1;
    if (target <= 0) return scenario;
  }
  return scenarios[scenarios.length - 1];
}

/**
 * A deterministic pseudo-random source.
 *
 * `Math.random` would make two runs of the same profile incomparable — which is
 * the whole point of a load test that gets re-run after a change.
 */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs one stage: `users` virtual users for `durationMs`.
 *
 * @param scenarios  `{ name, weight, run(client, context) }`
 * @param clients    signed-in clients, handed round-robin to the virtual users
 */
export async function runStage({
  scenarios, clients, users, durationMs, thinkTimeMs = 250, seed = 1, context = {}, onSample
}) {
  const endsAt = performance.now() + durationMs;
  const results = new Map();
  for (const scenario of scenarios) {
    results.set(scenario.name, { latencies: [], ok: 0, failed: 0, statuses: new Map() });
  }

  let inFlight = 0;
  let peakInFlight = 0;

  const worker = async index => {
    const random = seededRandom(seed + index * 7919);
    const client = clients[index % clients.length];

    while (performance.now() < endsAt) {
      const scenario = pick(scenarios, random());
      const bucket = results.get(scenario.name);

      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      const started = performance.now();

      try {
        const response = await scenario.run(client, { ...context, random });
        const ms = performance.now() - started;
        const status = response?.status ?? 0;

        bucket.latencies.push(ms);
        bucket.statuses.set(status, (bucket.statuses.get(status) ?? 0) + 1);
        // A 4xx is a valid answer to a request the test made badly; a 5xx or a
        // transport error is the server failing. Only the latter counts against it.
        if (status >= 500 || status === 0) bucket.failed++; else bucket.ok++;
        onSample?.({ scenario: scenario.name, ms, status });
      } catch (error) {
        const ms = performance.now() - started;
        bucket.latencies.push(ms);
        bucket.failed++;
        const key = error?.name === "TimeoutError" ? "timeout" : (error?.code ?? "error");
        bucket.statuses.set(key, (bucket.statuses.get(key) ?? 0) + 1);
        onSample?.({ scenario: scenario.name, ms, status: 0, error: key });
      } finally {
        inFlight--;
      }

      if (thinkTimeMs > 0) await sleep(thinkTimeMs * (0.5 + random()));
    }
  };

  const startedAt = performance.now();
  await Promise.all(Array.from({ length: users }, (_, index) => worker(index)));
  const elapsedMs = performance.now() - startedAt;

  const perScenario = {};
  let totalRequests = 0, totalFailed = 0;
  const allLatencies = [];

  for (const [name, bucket] of results) {
    const summary = summarise(bucket.latencies);
    totalRequests += bucket.ok + bucket.failed;
    totalFailed += bucket.failed;
    allLatencies.push(...bucket.latencies);
    perScenario[name] = {
      ...summary,
      ok: bucket.ok,
      failed: bucket.failed,
      statuses: Object.fromEntries([...bucket.statuses].sort((a, b) => b[1] - a[1]))
    };
  }

  return {
    users,
    elapsedMs,
    requests: totalRequests,
    failed: totalFailed,
    errorRate: totalRequests ? totalFailed / totalRequests : 0,
    throughput: totalRequests / (elapsedMs / 1000),
    peakInFlight,
    overall: summarise(allLatencies),
    scenarios: perScenario
  };
}
