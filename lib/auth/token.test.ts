import { describe, expect, it } from "vitest";
import { authorizeUrl, oauthConfigured } from "./github";
import { makeSessionToken, newOAuthState, readSessionToken, statesMatch } from "./token";

describe("session token", () => {
  const now = 1_700_000_000_000;

  it("round-trips a user id", () => {
    expect(readSessionToken(makeSessionToken("user-1", "secret", now), "secret", now + 1000)).toBe("user-1");
  });

  it("rejects an expired token", () => {
    const t = makeSessionToken("user-1", "secret", now, 1000);
    expect(readSessionToken(t, "secret", now + 999)).toBe("user-1");
    expect(readSessionToken(t, "secret", now + 1001)).toBeUndefined();
  });

  it("rejects a token made with another secret, a tampered one and a missing one", () => {
    const t = makeSessionToken("user-1", "secret", now);
    expect(readSessionToken(t, "other-secret", now)).toBeUndefined();
    expect(readSessionToken(t.slice(0, -2) + (t.endsWith("AA") ? "BB" : "AA"), "secret", now)).toBeUndefined();
    expect(readSessionToken("not-a-token", "secret", now)).toBeUndefined();
    expect(readSessionToken(undefined, "secret", now)).toBeUndefined();
  });
});

describe("OAuth state", () => {
  it("accepts only the identical state", () => {
    const s = newOAuthState();
    expect(statesMatch(s, s)).toBe(true);
    expect(statesMatch(s, newOAuthState())).toBe(false);
  });

  it("refuses a missing state on either side (a forged callback)", () => {
    expect(statesMatch(undefined, "abc")).toBe(false);
    expect(statesMatch("abc", undefined)).toBe(false);
    expect(statesMatch("", "")).toBe(false);
  });
});

describe("GitHub authorize URL", () => {
  const env = { GITHUB_OAUTH_CLIENT_ID: "cid", GITHUB_OAUTH_CLIENT_SECRET: "sec" } as unknown as NodeJS.ProcessEnv;

  it("asks for identity only and carries the state and redirect", () => {
    const u = new URL(authorizeUrl("st4te", "http://localhost:3000/api/auth/github/callback", env));
    expect(u.origin + u.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(u.searchParams.get("scope")).toBe("read:user");
    expect(u.searchParams.get("state")).toBe("st4te");
    expect(u.searchParams.get("client_id")).toBe("cid");
  });

  it("reports whether the OAuth app is configured", () => {
    expect(oauthConfigured(env)).toBe(true);
    expect(oauthConfigured({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
