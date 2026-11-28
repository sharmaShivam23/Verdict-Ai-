// Step 2: GitHub sends the person back with ?code&state. Check the state, trade
// the code for a token, read the profile, create or find the user, start a session.
// The GitHub access token is used once and never stored.

import { redirect } from "next/navigation";
import { exchangeCode, fetchProfile } from "@/lib/auth/github";
import { createSession, takeOAuthState } from "@/lib/auth/session";
import { statesMatch } from "@/lib/auth/token";
import { mongoStore } from "@/lib/connections-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? undefined;
  const state = url.searchParams.get("state") ?? undefined;
  const expected = await takeOAuthState();

  if (url.searchParams.get("error")) redirect("/login?error=denied");
  if (!code || !statesMatch(state, expected)) redirect("/login?error=state");

  let userId: string;
  try {
    const redirectUri = `${url.origin}/api/auth/github/callback`;
    const token = await exchangeCode(code, redirectUri);
    const profile = await fetchProfile(token);
    userId = (await mongoStore.upsertUserByGithub(profile)).id;
  } catch (e) {
    console.error("GitHub sign-in failed:", e instanceof Error ? e.message : e);
    redirect("/login?error=failed");
  }
  await createSession(userId);
  redirect("/");
}
