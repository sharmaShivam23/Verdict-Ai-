// A Connection is everything Verdict needs to act for ONE person or team: their
// Flagsmith project, optionally their GitHub repo and their model key.
//
// It comes from one of two places:
//  - "browser": what that person entered on the Connect page, kept in an
//    encrypted, httpOnly cookie in their own browser (no database, no accounts).
//  - "env": the server's .env.local, for the person running Verdict locally.
//
// A browser connection never falls back to the server's secrets, so on a shared
// deployment nobody can use the owner's keys.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface Connection {
  source: "env" | "browser";
  flagsmithApiKey?: string;
  /** "Api-Key" for an Organisation key, "Token" for a personal token. */
  authScheme: "Api-Key" | "Token";
  /** Client-side environment key (public by design). */
  environmentKey?: string;
  projectId?: string;
  apiUrl: string;
  /** Optional: pin the experiment the live dashboard opens with. */
  experimentId?: string;
  githubToken?: string;
  /** owner/name */
  githubRepo?: string;
  /** Folder the cleanup step may edit, e.g. "src/components/". Always ends with "/". */
  cleanupPath: string;
  geminiApiKey?: string;
  geminiModel?: string;
  /** Traffic is labelled SIMULATED unless the person says it is real. */
  trafficIsReal: boolean;
}

export const DEFAULT_API_URL = "https://api.flagsmith.com/api/v1";
export const DEFAULT_CLEANUP_PATH = "app/demo/";

const clean = (v: string | undefined) => {
  const t = v?.trim();
  return t ? t : undefined;
};

/** A safe, repo-relative folder: letters, digits, - _ . /, no "..", not hidden, ends with "/". */
export function normaliseCleanupPath(v: string | undefined): string | undefined {
  const t = clean(v);
  if (!t) return DEFAULT_CLEANUP_PATH;
  const withSlash = t.endsWith("/") ? t : `${t}/`;
  if (!/^[A-Za-z0-9_\-/.]+$/.test(withSlash)) return undefined;
  if (withSlash.startsWith("/") || withSlash.includes("//")) return undefined;
  const parts = withSlash.split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === ".." || p.startsWith("."))) return undefined;
  return withSlash;
}

export function connectionFromEnv(env: NodeJS.ProcessEnv = process.env): Connection {
  return {
    source: "env",
    flagsmithApiKey: clean(env.FLAGSMITH_API_KEY),
    authScheme: env.FLAGSMITH_AUTH_SCHEME === "Token" ? "Token" : "Api-Key",
    environmentKey: clean(env.FLAGSMITH_ENVIRONMENT_KEY),
    projectId: clean(env.FLAGSMITH_PROJECT_ID),
    apiUrl: clean(env.FLAGSMITH_API_URL) ?? DEFAULT_API_URL,
    experimentId: clean(env.FLAGSMITH_EXPERIMENT_ID),
    githubToken: clean(env.GITHUB_TOKEN),
    githubRepo: clean(env.GITHUB_REPO),
    cleanupPath: normaliseCleanupPath(env.VERDICT_CLEANUP_PATH) ?? DEFAULT_CLEANUP_PATH,
    geminiApiKey: clean(env.GEMINI_API_KEY),
    geminiModel: clean(env.GEMINI_MODEL),
    trafficIsReal: env.VERDICT_TRAFFIC_IS_REAL === "1",
  };
}

/** What the Connect page stores. Only these fields, nothing from the server. */
export type StoredConnection = Omit<Connection, "source" | "apiUrl"> & { apiUrl?: string };

export function connectionFromStored(s: StoredConnection): Connection {
  return {
    ...s,
    source: "browser",
    apiUrl: s.apiUrl ?? DEFAULT_API_URL,
    cleanupPath: normaliseCleanupPath(s.cleanupPath) ?? DEFAULT_CLEANUP_PATH,
  };
}

/** A short, non-secret fingerprint, so an agent session cannot cross connections. */
export function connectionFingerprint(c: Connection): string {
  return createHash("sha256")
    .update([c.source, c.flagsmithApiKey ?? "", c.environmentKey ?? "", c.githubRepo ?? ""].join("|"))
    .digest("hex")
    .slice(0, 16);
}

/** What the UI may show: never a secret, only whether it is set. */
export function describeConnection(c: Connection) {
  const mask = (v?: string) => (v ? `${v.slice(0, 4)}…${v.slice(-2)}` : null);
  return {
    source: c.source,
    flagsmith: Boolean(c.flagsmithApiKey && c.environmentKey),
    flagsmithKey: mask(c.flagsmithApiKey),
    environmentKey: c.environmentKey ?? null,
    projectId: c.projectId ?? null,
    github: Boolean(c.githubToken && c.githubRepo),
    githubRepo: c.githubRepo ?? null,
    cleanupPath: c.cleanupPath,
    model: Boolean(c.geminiApiKey),
    trafficIsReal: c.trafficIsReal,
  };
}

// ---------- who may use the SERVER's own keys ----------

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalHost(hostHeader: string | null | undefined): boolean {
  // Strip a trailing :port, then compare the whole host exactly (so "localhost.evil.com" is NOT local).
  return LOCAL_HOSTS.has((hostHeader ?? "").replace(/:\d+$/, "").toLowerCase());
}

/**
 * The keys in .env.local belong to whoever runs the server. They may be used for
 * requests that come from the same machine. On a public deployment a visitor must
 * bring their OWN keys (the Connect page), so strangers can never read or act on
 * the owner's Flagsmith project. VERDICT_ALLOW_REMOTE=1 opts out (single-owner use).
 */
export function mayUseServerKeys(hostHeader: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERDICT_ALLOW_REMOTE === "1" || isLocalHost(hostHeader);
}

/** A connection with nothing in it: used for visitors who may not use the server's keys. */
export function emptyConnection(): Connection {
  return connectionFromEnv({} as NodeJS.ProcessEnv);
}

// ---------- sealing (AES-256-GCM) ----------

let devSecret: string | undefined;

/**
 * VERDICT_SECRET must be set on any shared deployment. Locally, a random secret
 * is made per process: saved connections then last until the server restarts.
 */
export function sealingSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = clean(env.VERDICT_SECRET);
  if (s) return s;
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

const keyFrom = (secret: string) => createHash("sha256").update(`verdict-connection:${secret}`).digest();

export function seal(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Returns undefined for anything tampered with, expired by a secret change, or malformed. */
export function unseal<T>(sealed: string, secret: string): T | undefined {
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 29) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}
