// Step 1 of "Sign in with GitHub": remember a random `state`, then send the
// person to GitHub. The callback route checks the state came back unchanged.

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authorizeUrl, oauthConfigured } from "@/lib/auth/github";
import { setOAuthState } from "@/lib/auth/session";
import { newOAuthState } from "@/lib/auth/token";

export async function GET(request: Request) {
  // Per-request on purpose: it sets a fresh `state` cookie, so it must never be prerendered at build time.
  await connection();
  if (!oauthConfigured()) redirect("/login?error=not_configured");
  const state = newOAuthState();
  await setOAuthState(state);
  const redirectUri = `${new URL(request.url).origin}/api/auth/github/callback`;
  redirect(authorizeUrl(state, redirectUri));
}
