// "Sign in with GitHub": the OAuth web flow, identity only (scope read:user).
// This is separate from the fine-grained repo token used for cleanup pull requests.

import type { GithubProfile } from "../connections-store";

export function oauthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GITHUB_OAUTH_CLIENT_ID?.trim() && env.GITHUB_OAUTH_CLIENT_SECRET?.trim());
}

export function authorizeUrl(state: string, redirectUri: string, env: NodeJS.ProcessEnv = process.env): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID?.trim() ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", "read:user");
  u.searchParams.set("state", state);
  return u.toString();
}

const TIMEOUT = 15_000;

/** Trades the one-time `code` for an access token. Throws a short message on failure. */
export async function exchangeCode(
  code: string,
  redirectUri: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID?.trim(),
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET?.trim(),
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`GitHub sign-in failed (HTTP ${res.status}).`);
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!body.access_token) throw new Error(`GitHub sign-in failed${body.error ? `: ${body.error}` : "."}`);
  return body.access_token;
}

export async function fetchProfile(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<GithubProfile> {
  const res = await fetchImpl("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`Could not read your GitHub profile (HTTP ${res.status}).`);
  const u = (await res.json()) as { id?: number; login?: string; name?: string | null; avatar_url?: string };
  if (typeof u.id !== "number" || typeof u.login !== "string") throw new Error("GitHub returned an unexpected profile.");
  return { githubId: u.id, login: u.login, name: u.name ?? undefined, avatarUrl: u.avatar_url };
}
