// Server-only: picks the data source for the dashboard. Live mode talks to the
// Flagsmith Admin API with the given Connection; replay mode uses fixtures.

import { NoResultsYetError, toSnapshot } from "./flagsmith/adapter";
import type { Connection } from "./connection";
import { envPath, flagsmithRequest, getExperiment, getResults, isFlagsmithConnected } from "./flagsmith/client";
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

/** A pinned experiment (FLAGSMITH_EXPERIMENT_ID or the Connect page). Otherwise the first one is used. */
export function defaultExperimentId(conn: Connection): string | undefined {
  return parseExperiment(conn.experimentId);
}

export interface ExperimentListItem {
  id: number;
  name: string;
  status: string;
}

/** Experiments in the connected environment, for the picker. Empty on any failure. */
export async function listExperiments(conn: Connection): Promise<ExperimentListItem[]> {
  if (!isFlagsmithConnected(conn)) return [];
  try {
    const r = await flagsmithRequest<unknown>(envPath("experiments/", conn), {}, conn);
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
  conn: Connection,
  experimentId?: string,
): Promise<Loaded> {
  if (mode === "replay") return { snapshot: REPLAY_SCENARIOS[scenario] };

  if (!isFlagsmithConnected(conn)) {
    return { error: "Live mode needs a Flagsmith connection. Open Connect and add your keys." };
  }
  const id = experimentId ?? defaultExperimentId(conn);
  if (!id) {
    return { error: "No experiments found in this Flagsmith environment yet. Create one (the Agent page can do it), or use Replay." };
  }
  try {
    const [detail, results] = await Promise.all([
      getExperiment(id, conn),
      getResults(id, conn),
    ]);
    const snapshot = toSnapshot(detail, results, {
      // Traffic is simulated unless the person explicitly says otherwise.
      synthetic: !conn.trafficIsReal,
    });
    return { snapshot };
  } catch (e) {
    if (e instanceof NoResultsYetError) return { error: e.message };
    // The client never puts keys in error messages.
    return { error: e instanceof Error ? e.message : "Could not load the experiment." };
  }
}
