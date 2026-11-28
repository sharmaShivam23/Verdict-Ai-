// Pure helpers for the login session: a sealed (AES-GCM) token holding the user
// id and an expiry. No cookies here, so it can be unit tested.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { seal, unseal } from "../connection";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

interface SessionPayload {
  uid: string;
  exp: number;
}

export function makeSessionToken(userId: string, secret: string, now = Date.now(), ttl = SESSION_TTL_MS): string {
  return seal({ uid: userId, exp: now + ttl } satisfies SessionPayload, secret);
}

/** The user id, or undefined when the token is missing, tampered with, from another secret, or expired. */
export function readSessionToken(token: string | undefined, secret: string, now?: number): string | undefined {
  // The clock is read only once there is a token to check. Next.js refuses Date.now() while a page
  // is being prerendered, and a signed-out visitor has no token, so they never reach it.
  if (!token) return undefined;
  const p = unseal<SessionPayload>(token, secret);
  if (!p || typeof p.uid !== "string" || typeof p.exp !== "number") return undefined;
  return p.exp > (now ?? Date.now()) ? p.uid : undefined;
}

export const newOAuthState = () => randomBytes(16).toString("hex");

/** Constant-time compare of the OAuth `state` from the URL with the one we stored. */
export function statesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
