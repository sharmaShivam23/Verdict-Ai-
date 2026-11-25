// The Referee: deterministic rules that turn an experiment snapshot into a
// verdict plus an explainable checklist. No LLM is involved here. The LLM
// only phrases the explanation from this output, so it cannot invent a pass.
//
// Thresholds follow Flagsmith's documented behaviour:
//  - "collecting data" below 50 identities per arm or 5 conversions per arm
//  - winning = 95% chance to beat control, losing = under 5%
//  - 95% credible interval; if it crosses zero the result is inconclusive
//  - SRM warning when imbalance is one-in-a-thousand or rarer (p < 0.001)

import { flagsmithWinProbability, probVariantBeatsControl, sampleRatioMismatch } from "./stats";
import type {
  ArmStats,
  Check,
  Decision,
  ExperimentSnapshot,
} from "./types";

export const MIN_IDENTITIES_PER_ARM = 50;
export const MIN_CONVERSIONS_PER_ARM = 5;
export const SHIP_THRESHOLD = 0.95;
export const LOSE_THRESHOLD = 0.05;
export const SRM_P_THRESHOLD = 0.001;
/** Flagsmith only runs its SRM check from this many identities. */
export const SRM_MIN_TOTAL = 100;
/** Quarantined share of exposures above which we warn. */
export const QUARANTINE_WARN_SHARE = 0.01;
/**
 * Max gap between Flagsmith's win probability and our reproduction of its
 * formula. Measured on three real captures: 0.0002, 0.0006 and 0.0005.
 */
export const AUDIT_TOLERANCE = 0.005;

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

export function referee(s: ExperimentSnapshot): Decision {
  const checks: Check[] = [];
  const control = s.arms.find((a) => a.isControl);
  const treatments = s.arms.filter((a) => !a.isControl);

  if (!control || treatments.length === 0) {
    return {
      verdict: "INVALID",
      headline: "This experiment has no control or no treatment arm.",
      recommendedAction: "Fix the experiment setup before reading any result.",
      checks: [
        {
          id: "setup",
          label: "Experiment has a control and at least one treatment",
          status: "fail",
          detail: "Found " + s.arms.length + " arm(s).",
        },
      ],
      uncertainties: [],
    };
  }

  // 1. Data validity: SRM (our own test plus Flagsmith's warning).
  const srm = sampleRatioMismatch(
    s.arms.map((a) => a.exposures),
    s.arms.map((a) => a.configuredShare),
  );
  const srmFailed =
    s.flagsmithSrmWarning ||
    (srm.total >= SRM_MIN_TOTAL && srm.pValue < SRM_P_THRESHOLD);
  checks.push({
    id: "srm",
    label: "Traffic split matches the configured split (no SRM)",
    status: srmFailed ? "fail" : "pass",
    detail: srmFailed
      ? `Observed exposures ${s.arms
          .map((a) => `${a.name}=${a.exposures}`)
          .join(", ")} do not match the configured split (chi-square p=${formatP(
          srm.pValue,
        )}${s.flagsmithSrmWarning ? "; Flagsmith also raised its SRM warning" : ""}). Results cannot be trusted.`
      : srm.total < SRM_MIN_TOTAL
        ? `Only ${srm.total} identities so far; the SRM check needs at least ${SRM_MIN_TOTAL}.`
        : `Chi-square p=${formatP(srm.pValue)}, above the ${SRM_P_THRESHOLD} alarm level.`,
  });

  // 2. Quarantined identities.
  const totalExposed = s.arms.reduce((a, b) => a + b.exposures, 0);
  const quarantineShare =
    totalExposed + s.quarantinedIdentities > 0
      ? s.quarantinedIdentities / (totalExposed + s.quarantinedIdentities)
      : 0;
  checks.push({
    id: "quarantine",
    label: "Few identities were served more than one variation",
    status: quarantineShare > QUARANTINE_WARN_SHARE ? "warn" : "pass",
    detail: `${s.quarantinedIdentities} quarantined identities (${pct(
      quarantineShare,
    )} of enrolled). Flagsmith excludes them from every count.`,
  });

  // 3. Minimum sample per arm.
  const thin = s.arms.filter(
    (a) =>
      a.exposures < MIN_IDENTITIES_PER_ARM ||
      a.conversions < MIN_CONVERSIONS_PER_ARM,
  );
  checks.push({
    id: "sample",
    label: `Every arm has at least ${MIN_IDENTITIES_PER_ARM} identities and ${MIN_CONVERSIONS_PER_ARM} conversions`,
    status: thin.length === 0 ? "pass" : "fail",
    detail:
      thin.length === 0
        ? s.arms
            .map((a) => `${a.name}: ${a.exposures} identities, ${a.conversions} conversions`)
            .join("; ")
        : `Too little data in: ${thin
            .map((a) => `${a.name} (${a.exposures} identities, ${a.conversions} conversions)`)
            .join("; ")}.`,
  });

  // 4. Best treatment: win probability and interval.
  const best = pickBest(treatments);
  const bestWin = best?.winProbability;

  const {
    reproduced,
    secondMethod,
    gap: auditGap,
    agrees: auditAgrees,
    skipReason: auditSkipReason,
  } = auditWinProbability(s);

  const flagsmithWinOk = bestWin !== undefined && bestWin >= SHIP_THRESHOLD;
  // The gate is Flagsmith's number, protected by the reproduction check below.
  // The Beta-Binomial figure is informational only: it is never lower than
  // Flagsmith's (its formula is the more conservative one), so gating on it
  // would never block anything.
  const winOk = flagsmithWinOk;
  checks.push({
    id: "winprob",
    label: `Best variation has at least ${pct(SHIP_THRESHOLD, 0)} chance to beat control`,
    status: winOk ? "pass" : "fail",
    detail:
      best && bestWin !== undefined
        ? `${best.name} has a ${pct(bestWin)} chance to beat control according to Flagsmith${
            secondMethod !== undefined ? ` (a different method, exact Beta-Binomial, gives ${pct(secondMethod)}; informational)` : ""
          }.`
        : "No win probability reported yet.",
  });
  checks.push({
    id: "audit",
    label: "Flagsmith's win probability is reproduced from the raw counts",
    status: reproduced === undefined ? "warn" : auditAgrees ? "pass" : "fail",
    detail:
      reproduced === undefined
        ? `Not audited. ${auditSkipReason}`
        : `Flagsmith's own formula (normal approximation on the relative lift) applied to the raw counts gives ${pct(
            reproduced,
          )}; Flagsmith reports ${pct(bestWin!)}. Gap ${(auditGap! * 100).toFixed(2)} points, allowed ${(
            AUDIT_TOLERANCE * 100
          ).toFixed(1)}.`,
  });

  const ciOk =
    best?.ciLow !== undefined && best?.ciHigh !== undefined
      ? best.ciLow > 0
      : false;
  checks.push({
    id: "interval",
    label: "95% credible interval of the lift excludes zero (about 97.5% win probability)",
    status: ciOk ? "pass" : "fail",
    detail:
      best?.ciLow !== undefined && best?.ciHigh !== undefined
        ? `Lift ${signed(best.lift)} with interval ${signed(best.ciLow)} to ${signed(best.ciHigh)}.`
        : "No interval reported yet.",
  });

  // 5. Guardrails.
  const violated = s.guardrails.filter((g) =>
    g.direction === "should_not_increase" ? g.ciLow > 0 : g.ciHigh < 0,
  );
  checks.push({
    id: "guardrails",
    label: "No guardrail metric moved the wrong way",
    status: violated.length === 0 ? "pass" : "fail",
    detail:
      s.guardrails.length === 0
        ? "No guardrail metrics defined."
        : violated.length === 0
          ? s.guardrails.map((g) => `${g.name}: ${signed(g.delta)} (ok)`).join("; ")
          : `Violated: ${violated
              .map((g) => `${g.name} moved ${signed(g.delta)} (${signed(g.ciLow)} to ${signed(g.ciHigh)})`)
              .join("; ")}.`,
  });

  const uncertainties = buildUncertainties(s, treatments.length);

  // Decision order matters: invalid data beats everything else.
  if (srmFailed) {
    return {
      verdict: "INVALID",
      headline: "Do not trust this result: the traffic split is broken.",
      recommendedAction:
        "Stop acting on these numbers. Find why users were not split as configured (assignment bug, bot traffic, a variant that crashes before exposure), fix it and restart.",
      checks,
      uncertainties,
    };
  }

  if (thin.length > 0) {
    return {
      verdict: "KEEP_RUNNING",
      headline: "Still collecting data. It is too early to decide.",
      recommendedAction:
        "Keep the experiment running until every arm reaches the minimum sample.",
      checks,
      uncertainties,
    };
  }

  // Trust in the data beats everything below: if Flagsmith says "winner" but the
  // number cannot be reproduced from its own counts, do not ship on it.
  if (flagsmithWinOk && ciOk && reproduced !== undefined && !auditAgrees) {
    return {
      verdict: "INCONCLUSIVE",
      headline: `Flagsmith reports ${pct(bestWin!)} for ${best!.name}, but recomputing it from the raw counts gives ${pct(
        reproduced,
      )}. The numbers disagree, so Verdict will not ship on this result.`,
      recommendedAction:
        "Check the experiment data and Flagsmith's analysis before acting. Do not roll out until the number can be reproduced.",
      checks,
      uncertainties,
    };
  }

  if (winOk && ciOk && violated.length > 0) {
    return {
      verdict: "INCONCLUSIVE",
      headline: `${best!.name} wins on the primary metric but breaks a guardrail.`,
      recommendedAction:
        "Do not ship automatically. A human must decide whether the guardrail damage is acceptable.",
      checks,
      uncertainties,
    };
  }

  if (winOk && ciOk && best) {
    return {
      verdict: "SHIP",
      winner: best.name,
      headline: `${best.name} is a statistically credible winner.`,
      recommendedAction: `Roll out ${best.name} to everyone, end the experiment and clean up the losing code path.`,
      checks,
      uncertainties,
    };
  }

  const controlLikelyBest = treatments.every(
    (t) => t.winProbability !== undefined && t.winProbability <= LOSE_THRESHOLD,
  );
  if (controlLikelyBest) {
    return {
      verdict: "INCONCLUSIVE",
      headline: "The control is probably better than every variation.",
      recommendedAction:
        "End the experiment and keep the control. Clean up the losing variations.",
      checks,
      uncertainties,
    };
  }

  // The bar is cleared but the interval still includes zero. In Flagsmith's
  // model the 95% interval only excludes zero at about 97.5% win probability, so
  // its "95% chance to win" rollout banner can say go while its own interval says
  // inconclusive. Verdict waits, and says exactly why.
  if (winOk && !ciOk && best) {
    return {
      verdict: "KEEP_RUNNING",
      headline: `${best.name} clears the ${pct(SHIP_THRESHOLD, 0)} bar at ${pct(bestWin!)}, but its 95% interval (${signed(
        best.ciLow,
      )} to ${signed(best.ciHigh)}) still includes zero. Flagsmith's rollout banner may say go; Verdict waits.`,
      recommendedAction:
        "Keep the experiment running until the 95% interval excludes zero (about 97.5% win probability). A 95% win probability and a 95% two-sided interval only agree at that point.",
      checks,
      uncertainties,
    };
  }

  // Use a decimal when rounding would hide that the number is still under the bar.
  const cautious = bestWin;
  const digits = cautious !== undefined && pct(cautious, 0) === pct(SHIP_THRESHOLD, 0) ? 1 : 0;
  return {
    verdict: "KEEP_RUNNING",
    headline: best && cautious !== undefined
      ? `${best.name} leads at ${pct(cautious, digits)}, below the ${pct(SHIP_THRESHOLD, 0)} bar.`
      : "No variation has reached the evidence bar yet.",
    recommendedAction:
      "Do not ship yet. Stopping at the first promising number inflates false positives, so wait until the bar is met.",
    checks,
    uncertainties,
  };
}

export interface AuditResult {
  /** Flagsmith's own formula (normal approximation on relative lift) applied to the raw counts. */
  reproduced?: number;
  /** A different method: exact Beta-Binomial with a uniform prior. Informational second opinion; never gates shipping. */
  secondMethod?: number;
  /** What Flagsmith reported for the same variation. */
  flagsmith?: number;
  /** |reproduced - flagsmith|. */
  gap?: number;
  /** True when `reproduced` matches `flagsmith` within AUDIT_TOLERANCE. */
  agrees: boolean;
  skipReason?: string;
}

/**
 * Audit of Flagsmith's win probability from the raw counts:
 *  1. Reproduce it with Flagsmith's own formula (verified on three real
 *     captures to within 0.0006). A mismatch means the number is not what it
 *     claims to be.
 *  2. Compute a second opinion with a different model (Beta-Binomial). On real
 *     data the two differ by up to ~2 points, and Beta-Binomial is never the
 *     lower one, so it is shown for information and does not gate shipping.
 * Only valid for a two-arm test on an occurrence metric: with several variations
 * Flagsmith's figure may mean "chance to be best of all arms", which these
 * pairwise formulas do not model. Shared by the Referee and the dashboard.
 */
export function auditWinProbability(s: ExperimentSnapshot): AuditResult {
  const control = s.arms.find((a) => a.isControl);
  const treatments = s.arms.filter((a) => !a.isControl);
  const best = pickBest(treatments);
  const flagsmith = best?.winProbability;

  let skipReason: string | undefined;
  if (!control || !best) {
    skipReason = "The experiment has no control or no variation.";
  } else if (treatments.length > 1) {
    skipReason = "Several variations were tested, and the independent check only covers two-arm tests.";
  } else if (s.primaryAggregation !== undefined && s.primaryAggregation !== "occurrence") {
    skipReason = `The primary metric is "${s.primaryAggregation}", and the independent check only covers occurrence metrics.`;
  } else if (flagsmith === undefined) {
    skipReason = "Flagsmith has not reported a win probability yet.";
  } else if (best.conversions > best.exposures || control.conversions > control.exposures) {
    skipReason = "Conversions exceed identities, which a rate-based check cannot handle.";
  }
  if (skipReason !== undefined || !control || !best) {
    return { flagsmith, agrees: false, skipReason };
  }

  const c = { n: control.exposures, conversions: control.conversions };
  const v = { n: best.exposures, conversions: best.conversions };
  const secondMethod = probVariantBeatsControl(c, v);
  const reproduced = flagsmithWinProbability(c, v);
  if (reproduced === undefined) {
    return {
      secondMethod,
      flagsmith,
      agrees: false,
      skipReason: "A conversion rate of 0% or 100% makes Flagsmith's formula undefined, so it cannot be reproduced.",
    };
  }
  const gap = Math.abs(reproduced - flagsmith!);
  return { reproduced, secondMethod, flagsmith, gap, agrees: gap <= AUDIT_TOLERANCE };
}

function pickBest(treatments: ArmStats[]): ArmStats | undefined {
  return [...treatments].sort(
    (a, b) => (b.winProbability ?? -1) - (a.winProbability ?? -1),
  )[0];
}

function buildUncertainties(s: ExperimentSnapshot, nTreatments: number): string[] {
  const u: string[] = [];
  if (s.synthetic) {
    u.push("Traffic is simulated, so the result says nothing about real users.");
  }
  if (s.daysRunning < 7) {
    const span =
      s.daysRunning < 1 ? "less than a day" : `${s.daysRunning} day(s)`;
    u.push(
      `Only ${span} of data: weekday effects and novelty effects are not ruled out.`,
    );
  }
  if (nTreatments > 1) {
    u.push(
      "Several variations were compared at once, which raises the chance that one looks good by luck.",
    );
  }
  u.push("Only one primary metric decides the verdict.");
  u.push("Flagsmith Experimentation is in beta, so its numbers are not independently audited.");
  return u;
}

function signed(x: number | undefined): string {
  if (x === undefined) return "n/a";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

function formatP(p: number): string {
  return p < 0.0001 ? "<0.0001" : p.toFixed(4);
}
