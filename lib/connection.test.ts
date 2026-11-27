import { describe, expect, it } from "vitest";
import { getOrCreateSession, getSession } from "./agent/sessions";
import {
  connectionFingerprint,
  connectionFromEnv,
  connectionFromStored,
  describeConnection,
  normaliseCleanupPath,
  seal,
  unseal,
  type StoredConnection,
} from "./connection";

const stored: StoredConnection = {
  flagsmithApiKey: "ORGKEY12.secretsecretsecretsecretsecretse",
  authScheme: "Api-Key",
  environmentKey: "envKey123",
  projectId: "42",
  githubToken: "github_pat_SECRET",
  githubRepo: "shop/site",
  cleanupPath: "src/components/",
  geminiApiKey: "AIzaSECRET",
  trafficIsReal: false,
};

describe("sealed connection cookie", () => {
  const secret = "server-secret";

  it("round-trips", () => {
    expect(unseal<StoredConnection>(seal(stored, secret), secret)).toEqual(stored);
  });

  it("does not contain the keys in readable form", () => {
    const s = seal(stored, secret);
    for (const v of ["ORGKEY12", "github_pat_SECRET", "AIzaSECRET", "shop/site"]) expect(s).not.toContain(v);
  });

  it("rejects a tampered value, a wrong secret, and garbage", () => {
    const s = seal(stored, secret);
    const flipped = s.slice(0, 40) + (s[40] === "A" ? "B" : "A") + s.slice(41);
    expect(unseal(flipped, secret)).toBeUndefined();
    expect(unseal(s, "other-secret")).toBeUndefined();
    expect(unseal("not-a-cookie", secret)).toBeUndefined();
    expect(unseal("", secret)).toBeUndefined();
  });

  it("uses a fresh IV each time (same input, different cookie)", () => {
    expect(seal(stored, secret)).not.toBe(seal(stored, secret));
  });
});

describe("connections", () => {
  it("a browser connection never borrows the server's secrets", () => {
    const c = connectionFromStored({ ...stored, githubToken: undefined, geminiApiKey: undefined });
    expect(c.source).toBe("browser");
    expect(c.githubToken).toBeUndefined();
    expect(c.geminiApiKey).toBeUndefined();
  });

  it("reads .env.local values and trims blanks", () => {
    const c = connectionFromEnv({ FLAGSMITH_API_KEY: " k ", FLAGSMITH_ENVIRONMENT_KEY: "", GITHUB_REPO: "a/b" } as unknown as NodeJS.ProcessEnv);
    expect(c.flagsmithApiKey).toBe("k");
    expect(c.environmentKey).toBeUndefined();
    expect(c.cleanupPath).toBe("app/demo/");
  });

  it("describeConnection never exposes a secret", () => {
    const d = JSON.stringify(describeConnection(connectionFromStored(stored)));
    for (const v of ["secretsecret", "github_pat_SECRET", "AIzaSECRET"]) expect(d).not.toContain(v);
    expect(d).toContain("shop/site");
  });
});

describe("normaliseCleanupPath", () => {
  it("accepts a normal folder and adds the trailing slash", () => {
    expect(normaliseCleanupPath("src/components")).toBe("src/components/");
    expect(normaliseCleanupPath("app/demo/")).toBe("app/demo/");
    expect(normaliseCleanupPath("")).toBe("app/demo/");
  });

  it("rejects anything that could escape or touch hidden folders", () => {
    for (const bad of ["../x", "a/../b", "/etc", ".github/workflows", "src/.env", "a//b", "a b", "src\\x"]) {
      expect(normaliseCleanupPath(bad), bad).toBeUndefined();
    }
  });
});

describe("agent sessions are locked to a connection", () => {
  it("another connection cannot continue or approve in someone's session", () => {
    const alice = connectionFingerprint(connectionFromStored(stored));
    const bob = connectionFingerprint(connectionFromStored({ ...stored, flagsmithApiKey: "BOBKEY" }));
    expect(alice).not.toBe(bob);

    const s = getOrCreateSession(undefined, alice);
    expect(getSession(s.id, alice)).toBe(s);
    expect(getSession(s.id, bob)).toBeUndefined();
    expect(getOrCreateSession(s.id, bob).id).not.toBe(s.id);
  });
});
