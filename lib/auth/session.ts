// Cookie plumbing for the login session. Server-only (cookies, redirect).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { sealingSecret } from "../connection";
import { mongoStore, type UserRecord } from "../connections-store";
import { makeSessionToken, readSessionToken, SESSION_TTL_MS } from "./token";

export const SESSION_COOKIE = "verdict_session";
export const STATE_COOKIE = "verdict_oauth_state";

const secure = () => process.env.NODE_ENV === "production";

export async function createSession(userId: string, ttlMs: number = SESSION_TTL_MS): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, makeSessionToken(userId, sealingSecret(), Date.now(), ttlMs), {
    httpOnly: true,
    // Lax, not Strict: the cookie must be sent when GitHub sends the person back to us.
    sameSite: "lax",
    secure: secure(),
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function setOAuthState(state: string): Promise<void> {
  (await cookies()).set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge: 600 });
}

export async function takeOAuthState(): Promise<string | undefined> {
  const jar = await cookies();
  const v = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  return v;
}

/** The signed-in user's id, or undefined. Does not touch the database. */
export async function getSessionUserId(): Promise<string | undefined> {
  // Reading who is signed in is per-request by nature; say so, so nothing here is prerendered.
  await connection();
  return readSessionToken((await cookies()).get(SESSION_COOKIE)?.value, sealingSecret());
}

/** The signed-in user, or null (also null when the database is unreachable). */
export async function getCurrentUser(): Promise<UserRecord | null> {
  const id = await getSessionUserId();
  if (!id) return null;
  try {
    const user = await mongoStore.getUser(id);
    // MongoDB deletes expired guests a little later than their expiry, so check here too.
    if (user?.guest && user.expireAt && user.expireAt <= Date.now()) return null;
    return user;
  } catch (e) {
    console.error("getCurrentUser: database error:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** For pages that need an account: sends signed-out visitors to /login. */
export async function requireUser(): Promise<UserRecord> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
