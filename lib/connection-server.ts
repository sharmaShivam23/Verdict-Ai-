// Request-scoped connection for pages, route handlers and server actions.
//
// Who is asking decides everything: the signed-in user's ACTIVE saved connection
// (kept encrypted in MongoDB). There is deliberately NO fallback to .env.local for
// requests: a silent fallback once made the agent write to a different Flagsmith
// project than the one the person had connected. Signed out, or nothing saved,
// or a record that cannot be read, all give an empty connection ("not connected").
// Scripts under scripts/ still read .env.local through connectionFromEnv().

import { connectionFromStored, emptyConnection, type Connection } from "./connection";
import { getSessionUserId } from "./auth/session";
import { activeStored, mongoStore } from "./connections-store";

export async function getConnection(): Promise<Connection> {
  const userId = await getSessionUserId();
  if (!userId) return emptyConnection();
  try {
    const stored = await activeStored(mongoStore, userId);
    return stored ? connectionFromStored(stored) : emptyConnection();
  } catch (e) {
    console.error("getConnection: could not load the saved connection:", e instanceof Error ? e.message : e);
    return emptyConnection();
  }
}
