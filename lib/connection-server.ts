// Request-scoped connection for pages, route handlers and server actions.
// Reads the person's encrypted cookie; without one, falls back to .env.local.

import { cookies, headers } from "next/headers";
import {
  connectionFromEnv,
  connectionFromStored,
  emptyConnection,
  mayUseServerKeys,
  seal,
  sealingSecret,
  unseal,
  type Connection,
  type StoredConnection,
} from "./connection";

export const CONNECTION_COOKIE = "verdict_connection";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function getConnection(): Promise<Connection> {
  const raw = (await cookies()).get(CONNECTION_COOKIE)?.value;
  if (raw) {
    const stored = unseal<StoredConnection>(raw, sealingSecret());
    if (stored) return connectionFromStored(stored);
  }
  // No saved connection: the server's own keys are only for requests from this machine.
  const host = (await headers()).get("host");
  return mayUseServerKeys(host) ? connectionFromEnv() : emptyConnection();
}

/** Only call from a Server Function or Route Handler (cookies can only be set there). */
export async function saveConnection(s: StoredConnection): Promise<void> {
  (await cookies()).set(CONNECTION_COOKIE, seal(s, sealingSecret()), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
}

export async function clearConnection(): Promise<void> {
  (await cookies()).delete(CONNECTION_COOKIE);
}
