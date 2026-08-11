/**
 * The shapes of load a run can take.
 *
 * Each is a list of stages; a stage holds a user count for a duration. Ramps
 * are expressed as several stages rather than a continuous climb, because a
 * step that holds still long enough to measure gives a latency figure you can
 * attribute to a concurrency level — a continuous ramp gives a smear.
 *
 * Durations are deliberately short by default so a run fits inside a working
 * session; `--scale` multiplies every duration for an overnight soak.
 */

export const PROFILES = {
  /**
   * Does it work at all. One user, a few seconds — run this before anything
   * else, because every other profile's numbers are meaningless if the basic
   * path is broken.
   */
  smoke: {
    description: "One user, a short run. Proves the path works before measuring it.",
    mix: "read",
    thinkTimeMs: 100,
    stages: [{ users: 1, durationMs: 10_000 }]
  },

  /**
   * The expected working day. The question this answers is "is it comfortable
   * at the load we actually have", and the answer is a p95, not a maximum.
   */
  load: {
    description: "A normal working load held steady. Reports p95 at the expected concurrency.",
    mix: "mixed",
    thinkTimeMs: 400,
    stages: [
      { users: 5, durationMs: 20_000 },
      { users: 15, durationMs: 30_000 },
      { users: 30, durationMs: 30_000 }
    ]
  },

  /**
   * Climb until it hurts. The useful output is not the top number but the step
   * at which p95 turns upward — that is the capacity, and everything past it is
   * the shape of the degradation.
   */
  stress: {
    description: "Ramps concurrency until latency degrades. Finds the knee, not just the ceiling.",
    mix: "mixed",
    thinkTimeMs: 200,
    stages: [
      { users: 10, durationMs: 20_000 },
      { users: 25, durationMs: 20_000 },
      { users: 50, durationMs: 20_000 },
      { users: 100, durationMs: 20_000 },
      { users: 200, durationMs: 20_000 }
    ]
  },

  /**
   * A sudden arrival, then quiet, then the same again.
   *
   * The recovery stage is the point of it: a system that survives the spike but
   * stays slow afterwards has a queue it never drains, and that only shows up
   * if you keep measuring after the load stops.
   */
  spike: {
    description: "A sudden burst, then quiet, then a second burst. Measures recovery as much as survival.",
    mix: "read",
    thinkTimeMs: 50,
    stages: [
      { users: 5, durationMs: 15_000, label: "baseline" },
      { users: 150, durationMs: 20_000, label: "spike" },
      { users: 5, durationMs: 20_000, label: "recovery" },
      { users: 150, durationMs: 20_000, label: "second spike" },
      { users: 5, durationMs: 20_000, label: "settle" }
    ]
  },

  /**
   * A modest load held for a long time.
   *
   * Looks for what a short run cannot see: connection pools that leak, memory
   * that climbs, an index that stops fitting in cache. Compare the first and
   * last thirds of the latency series — a soak that ends slower than it started
   * has a leak even if nothing failed.
   */
  soak: {
    description: "A modest load held long enough to expose leaks and drift.",
    mix: "mixed",
    thinkTimeMs: 500,
    stages: [{ users: 10, durationMs: 600_000 }]
  },

  /**
   * The login endpoint alone.
   *
   * bcrypt at cost 12 is roughly 250–400 ms of pure CPU per attempt and cannot
   * be cached away, so a handful of concurrent logins saturates a small
   * instance. Worth knowing separately from the read mix, because the morning
   * is when everybody signs in at once.
   */
  login: {
    description: "Concurrent sign-ins. bcrypt is CPU-bound, so this is the sharpest limit in the app.",
    mix: "login",
    thinkTimeMs: 0,
    stages: [
      { users: 2, durationMs: 15_000 },
      { users: 8, durationMs: 15_000 },
      { users: 20, durationMs: 15_000 }
    ]
  }
};

/**
 * Thresholds a run is judged against, so a profile can pass or fail rather than
 * only produce numbers. Chosen for an app whose database is a hosted Atlas
 * cluster across the internet — a self-hosted Mongo on the same box would
 * deserve much tighter figures.
 */
export const THRESHOLDS = {
  smoke: { p95: 2_000, errorRate: 0 },
  load: { p95: 3_000, errorRate: 0.01 },
  stress: { errorRate: 0.05 },
  spike: { errorRate: 0.05 },
  soak: { p95: 3_000, errorRate: 0.01 },
  login: { p95: 5_000, errorRate: 0.01 }
};
