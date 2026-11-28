// Minimal Flagsmith Admin API client. Server-side only: it uses the Admin API
// key from a Connection and must never be imported into browser code.
// Every function takes the Connection to act for; it defaults to .env.local so
// the command-line scripts keep working unchanged.

import { connectionFromEnv, type Connection } from "../connection";
import type { FlagsmithExperimentDetail, FlagsmithResults } from "./adapter";

export class NotConnectedError extends Error {}

function config(conn: Connection) {
  if (!conn.flagsmithApiKey || !conn.environmentKey) {
    throw new NotConnectedError(
      conn.source === "browser"
        ? "Your saved connection is missing the Flagsmith API key or environment key. Open Connect to fix it."
        : "Flagsmith is not connected. Open Connect, or set FLAGSMITH_API_KEY and FLAGSMITH_ENVIRONMENT_KEY in .env.local.",
    );
  }
  return { apiKey: conn.flagsmithApiKey, envKey: conn.environmentKey, projectId: conn.projectId, base: conn.apiUrl, scheme: conn.authScheme };
}

export const isFlagsmithConnected = (conn: Connection) => Boolean(conn.flagsmithApiKey && conn.environmentKey);

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class FlagsmithHttpError extends Error {
  constructor(
    public status: number,
    public method: string,
    public path: string,
    /** Flagsmith's validation message, if any. Never contains the API key. */
    public detail: string,
  ) {
    super(`Flagsmith ${method} ${path} failed: HTTP ${status}${detail ? ` - ${detail}` : ""}`);
  }
}

/** Low-level request. `path` is relative to the API base, e.g. "projects/1/features/". */
export async function flagsmithRequest<T>(
  path: string,
  opts: { method?: HttpMethod; body?: unknown } = {},
  conn: Connection = connectionFromEnv(),
): Promise<T> {
  const c = config(conn);
  const method = opts.method ?? "GET";
  const res = await fetch(`${c.base}/${path}`, {
    method,
    headers: {
      Authorization: `${c.scheme} ${c.apiKey}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    // Never wait forever: a stuck request would freeze the Connect page's Test button.
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      /* ignore */
    }
    throw new FlagsmithHttpError(res.status, method, path, detail);
  }
  if (res.status === 202 || res.status === 204) return {} as T;
  return (await res.json()) as T;
}

/** Path scoped to the connection's client environment key. */
export function envPath(sub: string, conn: Connection = connectionFromEnv()): string {
  return `environments/${config(conn).envKey}/${sub}`;
}

export function projectPath(sub: string, conn: Connection = connectionFromEnv()): string {
  const id = config(conn).projectId;
  if (!id) throw new NotConnectedError("The Flagsmith project id is not set. Open Connect to add it.");
  return `projects/${id}/${sub}`;
}

export const getExperiment = (id: number | string, conn: Connection = connectionFromEnv()) =>
  flagsmithRequest<FlagsmithExperimentDetail>(envPath(`experiments/${id}/`, conn), {}, conn);

export const getResults = (id: number | string, conn: Connection = connectionFromEnv()) =>
  flagsmithRequest<FlagsmithResults>(envPath(`experiments/${id}/results/`, conn), {}, conn);

/** Asks Flagsmith to recompute results. Rate limited to once every 5 minutes. */
export const refreshResults = (id: number | string, conn: Connection = connectionFromEnv()) =>
  flagsmithRequest<unknown>(envPath(`experiments/${id}/results/refresh/`, conn), { method: "POST" }, conn);
