import mongoose from "mongoose";

/**
 * Registering every schema here means `populate()` always resolves, wherever it
 * is called from.
 *
 * A route that populates a reference it does not itself import otherwise throws
 * MissingSchemaError — but only on a cold server, because visiting some other
 * page first happens to register the model. That makes it look like an
 * intermittent fault rather than a missing import. Every caller already awaits
 * connectDb(), so this is the one place that fixes it for all of them.
 */
import "@/models/User";
import "@/models/Doctor";
import "@/models/Visit";
import "@/models/VisitPhoto";
import "@/models/RoutePlan";
import "@/models/Catalog";
import "@/models/Sample";
import "@/models/HR";
import "@/models/Payroll";
import "@/models/Sales";
import "@/models/Finance";

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalWithMongoose = globalThis as typeof globalThis & { mongooseCache?: Cache };
const cache = globalWithMongoose.mongooseCache ?? { conn: null, promise: null };
globalWithMongoose.mongooseCache = cache;

/**
 * Sized for a serverless host, where the unit of scale is the instance and each
 * one serves a handful of requests at a time.
 *
 * `maxPoolSize` is deliberately small: the default of 100 is written for one
 * long-lived server, and on Vercel it means every warm instance can hold a
 * hundred sockets open against Atlas, which reaches the cluster's connection
 * ceiling long before it reaches its capacity for work. Ten is more than a
 * single instance can use, and `minPoolSize: 0` lets an idle one give them back.
 *
 * The two timeouts exist so a cluster that has gone away fails in seconds
 * rather than hanging until the platform kills the function — a request that
 * errors can be retried, one that hangs looks to the user like the app is
 * simply broken.
 */
const OPTIONS = {
  bufferCommands: false,
  maxPoolSize: 10,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 8000,
  socketTimeoutMS: 45000
} as const;

export async function connectDb() {
  if (cache.conn) return cache.conn;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured");
  /*
   * The rejection has to clear the cached promise, or the first failed connect
   * is the last one this instance ever attempts: `??=` sees a promise, hands
   * back the same rejected one, and every request for the life of the instance
   * fails with an error from minutes ago. Atlas being briefly unreachable —
   * a failover, a paused cluster, a cold DNS lookup — would take the site down
   * until it happened to be redeployed.
   */
  cache.promise ??= mongoose.connect(uri, OPTIONS).catch(error => {
    cache.promise = null;
    throw error;
  });
  cache.conn = await cache.promise;
  return cache.conn;
}
