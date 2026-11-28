// Deterministic autonomy policy. This is code, not a prompt: the model cannot
// talk its way past it. Reads run on their own, writes stop for approval, and
// the one irreversible action needs a typed confirmation AND a passing
// Referee verdict.

import type { Decision } from "../types";

export type Risk = "read" | "write" | "irreversible";

export const TOOL_RISK = {
  list_experiments: "read",
  get_experiment_verdict: "read",
  refresh_results: "read",
  create_feature: "write",
  create_metric: "write",
  create_experiment: "write",
  start_experiment: "write",
  pause_experiment: "write",
  complete_experiment: "irreversible",
  find_flag_references: "read",
  generate_integration_snippet: "read",
  check_integration: "read",
  open_cleanup_pr: "write",
} as const satisfies Record<string, Risk>;

export type ToolName = keyof typeof TOOL_RISK;

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_RISK, name);
}

export function riskOf(name: string): Risk | undefined {
  return isToolName(name) ? TOOL_RISK[name] : undefined;
}

type Obj = Record<string, unknown>;
const asObj = (x: unknown): Obj => (x && typeof x === "object" ? (x as Obj) : {});

/** Phrase the human must type to approve an irreversible action. */
export function confirmPhrase(name: string, input: unknown): string | undefined {
  if (riskOf(name) !== "irreversible") return undefined;
  const i = asObj(input);
  return `COMPLETE ${String(i.experiment_id ?? "?")}`;
}

/** One-line, human-readable description shown on the approval card. */
export function describeAction(name: string, input: unknown): string {
  const i = asObj(input);
  switch (name) {
    case "create_feature":
      return `Create multivariate flag "${i.name}" with variations ${JSON.stringify(
        (Array.isArray(i.variants) ? i.variants : []).map((v) => asObj(v).key),
      )}.`;
    case "create_metric":
      return `Create metric "${i.name}" counting the event "${i.event_name}" (higher is better).`;
    case "create_experiment":
      return `Create experiment "${i.name}" on flag #${i.feature_id} (hypothesis: ${i.hypothesis}). It will NOT start yet.`;
    case "start_experiment":
      return `START experiment #${i.experiment_id}. The flag and its variations lock while it runs.`;
    case "pause_experiment":
      return `Pause experiment #${i.experiment_id}.`;
    case "complete_experiment":
      return `COMPLETE experiment #${i.experiment_id} and make the flag serve: ${i.rollout_decision}${
        i.rollout_variant ? ` (variation option #${i.rollout_variant})` : ""
      }. This ends the experiment permanently and cannot be undone.`;
    case "open_cleanup_pr":
      return `Open a pull request that removes the losing code path for experiment #${i.experiment_id} in ${i.file_path} (or show the diff if GitHub is not configured). Only touches app/demo/.`;
    default:
      return `${name}(${JSON.stringify(input)})`;
  }
}

export interface Gate {
  allowed: boolean;
  reason: string;
}

/**
 * The Referee gate. Rolling a variant out to everyone is allowed only when the
 * deterministic Referee says SHIP for exactly that variant. Falling back to
 * control or disabling the flag is the safe direction and is always allowed
 * (still behind human approval).
 */
export function gateComplete(
  rolloutDecision: string,
  variantKey: string | undefined,
  d?: Decision,
): Gate {
  if (rolloutDecision === "control" || rolloutDecision === "disable") {
    return { allowed: true, reason: `Rolling back to ${rolloutDecision} is the safe direction.` };
  }
  if (rolloutDecision !== "variant") {
    return { allowed: false, reason: `Unknown rollout_decision "${rolloutDecision}".` };
  }
  if (!d) {
    return { allowed: false, reason: "Refused: no Referee decision is available for this experiment." };
  }
  if (d.verdict !== "SHIP") {
    return {
      allowed: false,
      reason: `Refused: the Referee verdict is ${d.verdict}, not SHIP. ${d.headline}`,
    };
  }
  if (!variantKey || d.winner !== variantKey) {
    return {
      allowed: false,
      reason: `Refused: the Referee's winner is "${d.winner}", not "${variantKey ?? "unknown"}".`,
    };
  }
  return { allowed: true, reason: `Referee verdict is SHIP for ${variantKey}.` };
}
