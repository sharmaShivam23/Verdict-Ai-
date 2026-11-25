// Minimal Flagsmith Admin API client. Server-side only: it reads the Admin API
// key from the environment and must never be imported into browser code.

import type { FlagsmithExperimentDetail, FlagsmithResults } from "./adapter";

function config() {
  const apiKey = process.env.FLAGSMITH_API_KEY;
  const envKey = process.env.FLAGSMITH_ENVIRONMENT_KEY;
  if (!apiKey) throw new Error("FLAGSMITH_API_KEY is not set");
  if (!envKey) throw new Error("FLAGSMITH_ENVIRONMENT_KEY is not set");
  return {
    apiKey,
    envKey,
    projectId: process.env.FLAGSMITH_PROJECT_ID,
    base: process.env.FLAGSMITH_API_URL ?? "https://api.flagsmith.com/api/v1",
    // Organisation API keys use "Api-Key"; personal tokens use "Token".
    scheme: process.env.FLAGSMITH_AUTH_SCHEME ?? "Api-Key",
  };
}

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
): Promise<T> {
  const c = config();
  const method = opts.method ?? "GET";
  const res = await fetch(`${c.base}/${path}`, {
    method,
    headers: {
      Authorization: `${c.scheme} ${c.apiKey}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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

/** Path scoped to the configured client environment key. */
export function envPath(sub: string): string {
  return `environments/${config().envKey}/${sub}`;
}

export function projectPath(sub: string): string {
  const id = config().projectId;
  if (!id) throw new Error("FLAGSMITH_PROJECT_ID is not set");
  return `projects/${id}/${sub}`;
}

export const getExperiment = (id: number | string) =>
  flagsmithRequest<FlagsmithExperimentDetail>(envPath(`experiments/${id}/`));

export const getResults = (id: number | string) =>
  flagsmithRequest<FlagsmithResults>(envPath(`experiments/${id}/results/`));

/** Asks Flagsmith to recompute results. Rate limited to once every 5 minutes. */
export const refreshResults = (id: number | string) =>
  flagsmithRequest<unknown>(envPath(`experiments/${id}/results/refresh/`), {
    method: "POST",
  });
