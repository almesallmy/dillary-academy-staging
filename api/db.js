// api/db.js
// Reuse a single Mongoose connection across serverless invocations.
// Vercel keeps module state on warm instances, so a global cache avoids
// creating a new connection pool per request.

import mongoose from "mongoose";

let cached = global.__mongooseCached;
if (!cached) {
  cached = { conn: null, promise: null };
  global.__mongooseCached = cached;
}

/**
 * Establish (or reuse) a single Mongoose connection.
 * Returns the ready Mongoose instance.
 */
export async function dbConnect() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");

    // Keep options lean—pool sizing is best set in the URI (e.g., &maxPoolSize=5)
    cached.promise = mongoose
      .connect(uri, {
        bufferCommands: false,           // don't buffer if disconnected
        serverSelectionTimeoutMS: 30000, // fail fast on bad hosts
        socketTimeoutMS: 45000,          // avoid hung sockets
      })
      .then((m) => m);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}