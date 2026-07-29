import mongoose from "mongoose";
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
