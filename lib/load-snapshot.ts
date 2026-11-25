// Server-only: picks the data source for the dashboard. Live mode talks to the
// Flagsmith Admin API using server-side env vars; replay mode uses fixtures.

import { NoResultsYetError, toSnapshot } from "./flagsmith/adapter";
import { envPath, flagsmithRequest, getExperiment, getResults } from "./flagsmith/client";
import { REPLAY_SCENARIOS } from "./replay";
import type { ExperimentSnapshot } from "./types";

export type Mode = "live" | "replay";
export type ScenarioId = keyof typeof REPLAY_SCENARIOS;

export interface Loaded {
  snapshot?: ExperimentSnapshot;
  error?: string;
}

export function parseMode(v: string | string[] | undefined): Mode {
  return v === "live" ? "live" : "replay";
}

export function parseScenario(v: string | string[] | undefined): ScenarioId {
  return v === "B" || v === "C" || v === "D" ? v : "A";
}

/** The id goes into an Admin API path, so only plain digits are accepted. */
export function parseExperiment(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && /^\d{1,12}$/.test(v) ? v : undefined;
}

export function defaultExperimentId(): string {
  return process.env.FLAGSMITH_EXPERIMENT_ID ?? "406";
}

export interface ExperimentListItem {
  id: number;
  name: string;
  status: string;
}

/** Experiments in the connected environment, for the picker. Empty on any failure. */
export async function listExperiments(): Promise<ExperimentListItem[]> {
  if (!process.env.FLAGSMITH_API_KEY) return [];
  try {
    const r = await flagsmithRequest<unknown>(envPath("experiments/"));
    const items = Array.isArray(r) ? r : (((r as { results?: unknown[] })?.results ?? []) as unknown[]);
    return (items as Record<string, unknown>[])
      .filter((e) => typeof e.id === "number")
      .map((e) => ({ id: e.id as number, name: String(e.name ?? `Experiment ${e.id}`), status: String(e.status ?? "") }));
  } catch {
    return [];
  }
}

export async function loadSnapshot(
  mode: Mode,
  scenario: ScenarioId,
  experimentId?: string,
): Promise<Loaded> {
  if (mode === "replay") return { snapshot: REPLAY_SCENARIOS[scenario] };

  if (!process.env.FLAGSMITH_API_KEY) {
    return { error: "Live mode needs FLAGSMITH_API_KEY in .env.local." };
  }
  const id = experimentId ?? defaultExperimentId();
  try {
    const [detail, results] = await Promise.all([
      getExperiment(id),
      getResults(id),
    ]);
    const snapshot = toSnapshot(detail, results, {
      // Traffic is simulated unless the operator explicitly says otherwise.
      synthetic: process.env.VERDICT_TRAFFIC_IS_REAL !== "1",
    });
    return { snapshot };
  } catch (e) {
    if (e instanceof NoResultsYetError) return { error: e.message };
    // The client never puts keys in error messages.
    return { error: e instanceof Error ? e.message : "Could not load the experiment." };
  }
}
