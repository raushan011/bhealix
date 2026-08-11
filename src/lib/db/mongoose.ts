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

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalWithMongoose = globalThis as typeof globalThis & { mongooseCache?: Cache };
const cache = globalWithMongoose.mongooseCache ?? { conn: null, promise: null };
globalWithMongoose.mongooseCache = cache;

export async function connectDb() {
  if (cache.conn) return cache.conn;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured");
  cache.promise ??= mongoose.connect(uri, { bufferCommands: false });
  cache.conn = await cache.promise;
  return cache.conn;
}
