// One MongoDB connection per server process. Kept on globalThis so `next dev`
// hot reloads reuse it instead of opening a new pool on every edit.

import { MongoClient, type Db } from "mongodb";

export class DbNotConfiguredError extends Error {
  constructor() {
    super("MONGODB_URI is not set. Add your MongoDB connection string to .env.local.");
  }
}

const g = globalThis as { __verdictMongo?: Promise<MongoClient> };

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new DbNotConfiguredError();
  g.__verdictMongo ??= new MongoClient(uri, { serverSelectionTimeoutMS: 8000 }).connect();
  try {
    const client = await g.__verdictMongo;
    return client.db(process.env.MONGODB_DB?.trim() || "verdict");
  } catch (e) {
    g.__verdictMongo = undefined; // allow a retry after a failed connect
    throw e;
  }
}
