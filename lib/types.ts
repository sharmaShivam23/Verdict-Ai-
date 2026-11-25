// Normalised experiment data. The Flagsmith adapter (to be written after the
// Day 0 check of the real results API) maps its response into these types.
// Replay scenarios are plain ExperimentSnapshot objects.

export type Verdict = "SHIP" | "KEEP_RUNNING" | "INCONCLUSIVE" | "INVALID";

export interface ArmStats {
  name: string;
  isControl: boolean;
  /** Identities counted as exposed to this arm. */
  exposures: number;
  /** Identities that converted (occurrence metric). */
  conversions: number;
  /** Configured share of enrolled traffic, 0..1. Shares across arms sum to 1. */
  configuredShare: number;
  /** Flagsmith's reported "chance to beat control", 0..1. Absent for control. */
  winProbability?: number;
  /** Relative lift vs control, e.g. 0.11 for +11%. Absent for control. */
  lift?: number;
  /** 95% credible interval bounds of the relative lift. Absent for control. */
  ciLow?: number;
  ciHigh?: number;
}

export interface GuardrailStats {
  name: string;
  direction: "should_not_increase" | "should_not_decrease";
  /** Relative change vs control for the guardrail metric. */
  delta: number;
  /** 95% credible interval of the relative change. */
  ciLow: number;
  ciHigh: number;
}

export interface ExperimentSnapshot {
  id: string;
  name: string;
  hypothesis: string;
  primaryMetric: string;
  /**
   * How the primary metric is aggregated ("occurrence", "count", "sum", "mean").
   * The independent audit is only valid for "occurrence". Absent means occurrence.
   */
  primaryAggregation?: string;
  arms: ArmStats[];
  /** Identities served more than one variation, excluded by Flagsmith. */
  quarantinedIdentities: number;
  /** True if Flagsmith itself raised its sample ratio mismatch warning. */
  flagsmithSrmWarning: boolean;
  guardrails: GuardrailStats[];
  daysRunning: number;
  source: "live" | "replay";
  /** True when the payload was hand-built, not captured from Flagsmith. Always shown in the UI. */
  constructed?: boolean;
  /** True when traffic was simulated. Always disclosed in the UI. */
  synthetic: boolean;
}

export type CheckStatus = "pass" | "fail" | "warn";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface Decision {
  verdict: Verdict;
  /** Winning arm name when verdict is SHIP. */
  winner?: string;
  /** One sentence the dashboard shows next to the verdict. */
  headline: string;
  recommendedAction: string;
  checks: Check[];
  /** Assumptions that remain uncertain even when every check passes. */
  uncertainties: string[];
}
