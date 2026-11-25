// Maps Flagsmith Admin API responses into the Referee's ExperimentSnapshot.
// Shapes below were captured from the live API (see fixtures/experiment-406.json).

import type {
  ArmStats,
  ExperimentSnapshot,
  GuardrailStats,
} from "../types";

export interface FlagsmithExperimentDetail {
  id: number;
  name: string;
  hypothesis: string;
  status: string;
  /** Recorded when the experiment is completed (see lib/agent/cleanup.ts). Shapes seen only for running experiments so far. */
  ended_at?: string | null;
  rollout_decision?: string | null;
  rollout_variant?: number | null;
  feature: {
    name?: string;
    multivariate_options: { id: number; key: string; string_value: string }[];
  };
  metrics: {
    metric: number;
    metric_name: string;
    aggregation?: string;
    expected_direction: string;
  }[];
  experiment_rollout: {
    multivariate_feature_state_values: {
      multivariate_feature_option: number;
      percentage_allocation: number;
    }[];
  };
  started_at: string | null;
}

interface VariantInference {
  lift: number;
  ci_low: number;
  ci_high: number;
  chance_to_win: number;
}

export interface FlagsmithResults {
  results: null | {
    as_of: string;
    payload: {
      metrics: {
        metric_id: number;
        variants: Record<string, { n: number; sum: number }>;
        inference: Record<string, VariantInference>;
      }[];
      srm_p_value: number | null;
    };
    is_final: boolean;
  };
}

export const CONTROL_KEY = "control";

export class NoResultsYetError extends Error {
  constructor() {
    super(
      "Flagsmith has not computed results yet. Trigger results/refresh/ and wait for the warehouse to process events.",
    );
  }
}

export class UnsupportedMetricError extends Error {
  constructor(metricName: string) {
    super(
      `The primary metric "${metricName}" is a "lower is better" goal. Verdict has not verified how Flagsmith reports win probability for those, so it refuses to give a verdict rather than risk a wrong one. Use a "higher is better" primary metric.`,
    );
  }
}

/** "should not increase" style directions mark guardrail metrics. */
function guardrailDirection(
  expected: string,
): GuardrailStats["direction"] | null {
  const d = expected.toLowerCase();
  if (!d.includes("not")) return null;
  return d.includes("decrease") ? "should_not_decrease" : "should_not_increase";
}

export function toSnapshot(
  detail: FlagsmithExperimentDetail,
  res: FlagsmithResults,
  opts: { synthetic: boolean; now?: Date; source?: "live" | "replay"; constructed?: boolean },
): ExperimentSnapshot {
  if (!res.results) throw new NoResultsYetError();
  const { payload } = res.results;

  // The first goal metric is primary. Metrics whose expected direction is a
  // "should not ..." guardrail are checked separately.
  const goalMetrics = detail.metrics.filter(
    (m) => guardrailDirection(m.expected_direction) === null,
  );
  const primary = goalMetrics[0] ?? detail.metrics[0];
  if (!primary) throw new Error("Experiment has no metrics");
  if (primary.expected_direction === "decrease") {
    throw new UnsupportedMetricError(primary.metric_name);
  }

  const primaryResult = payload.metrics.find((m) => m.metric_id === primary.metric);
  if (!primaryResult) {
    throw new Error(`No results for primary metric ${primary.metric} yet`);
  }

  // Configured traffic shares among enrolled identities. Treatments carry an
  // explicit allocation; control gets the remainder.
  const keyByOptionId = new Map(
    detail.feature.multivariate_options.map((o) => [o.id, o.key]),
  );
  const treatmentPct = new Map<string, number>();
  for (const v of detail.experiment_rollout.multivariate_feature_state_values) {
    const key = keyByOptionId.get(v.multivariate_feature_option);
    if (key) treatmentPct.set(key, v.percentage_allocation);
  }
  const treatmentTotal = [...treatmentPct.values()].reduce((a, b) => a + b, 0);

  const arms: ArmStats[] = Object.entries(primaryResult.variants).map(
    ([key, v]) => {
      const isControl = key === CONTROL_KEY;
      const inf = primaryResult.inference[key];
      return {
        name: key,
        isControl,
        exposures: v.n,
        conversions: v.sum,
        configuredShare:
          (isControl ? 100 - treatmentTotal : (treatmentPct.get(key) ?? 0)) / 100,
        winProbability: inf?.chance_to_win,
        lift: inf?.lift,
        ciLow: inf?.ci_low,
        ciHigh: inf?.ci_high,
      };
    },
  );

  const guardrails: GuardrailStats[] = [];
  for (const m of detail.metrics) {
    const direction = guardrailDirection(m.expected_direction);
    if (!direction) continue;
    const r = payload.metrics.find((x) => x.metric_id === m.metric);
    const inf = r && Object.values(r.inference)[0];
    if (inf) {
      guardrails.push({
        name: m.metric_name,
        direction,
        delta: inf.lift,
        ciLow: inf.ci_low,
        ciHigh: inf.ci_high,
      });
    }
  }

  const startedAt = detail.started_at ? new Date(detail.started_at) : null;
  const now = opts.now ?? new Date();
  const daysRunning = startedAt
    ? Math.max(0, (now.getTime() - startedAt.getTime()) / 86_400_000)
    : 0;

  return {
    id: String(detail.id),
    name: detail.name,
    hypothesis: detail.hypothesis,
    primaryMetric: primary.metric_name,
    primaryAggregation: primary.aggregation,
    arms,
    // Flagsmith's results payload does not expose a quarantined-identity count.
    quarantinedIdentities: 0,
    flagsmithSrmWarning:
      payload.srm_p_value !== null && payload.srm_p_value < 0.001,
    guardrails,
    daysRunning: Math.round(daysRunning * 10) / 10,
    source: opts.source ?? "live",
    ...(opts.constructed ? { constructed: true } : {}),
    synthetic: opts.synthetic,
  };
}
