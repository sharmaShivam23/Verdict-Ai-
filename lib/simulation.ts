// Planning helpers for simulated traffic. Pure functions, so they are tested
// without touching Flagsmith. Simulated identities are always prefixed "sim-".

export interface Assignment {
  id: string;
  /** The flag value the identity was served, e.g. "control" or "variant_a". */
  arm: string;
}

/**
 * Decides which identities convert, with EXACT per-arm quotas: an arm with n
 * enrolled identities and rate r gets round(r * n) conversions. Deterministic
 * (the first k identities of each arm, in assignment order), so a capture run
 * hits its target counts instead of drifting with random noise.
 */
export function planConversions(
  assignments: Assignment[],
  rateFor: (arm: string) => number,
): { converters: Set<string>; perArm: Record<string, { n: number; converted: number }> } {
  const byArm = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const list = byArm.get(a.arm) ?? [];
    list.push(a);
    byArm.set(a.arm, list);
  }

  const converters = new Set<string>();
  const perArm: Record<string, { n: number; converted: number }> = {};
  for (const [arm, list] of byArm) {
    const rate = rateFor(arm);
    if (!(rate >= 0 && rate <= 1)) throw new RangeError(`Conversion rate for "${arm}" must be between 0 and 1.`);
    const k = Math.round(rate * list.length);
    for (const a of list.slice(0, k)) converters.add(a.id);
    perArm[arm] = { n: list.length, converted: k };
  }
  return { converters, perArm };
}

import { flagsmithWinProbability, probVariantBeatsControl } from "./stats";

type Counts = { n: number; conversions: number };

/**
 * Picks the variant conversion count whose win probability is closest to
 * `target`, given the control's counts. Used to stage a capture (for example
 * "about 84%") from whatever arm sizes Flagsmith's bucketing produced.
 * `winFn` defaults to Flagsmith's own formula, because that is the number the
 * experiment page and the Referee act on.
 */
export function conversionsForTargetWin(
  control: Counts,
  variantN: number,
  target: number,
  winFn: (c: Counts, v: Counts) => number | undefined = flagsmithWinProbability,
): { conversions: number; probability: number } {
  if (!(target > 0 && target < 1)) throw new RangeError("target must be between 0 and 1");
  let best: { conversions: number; probability: number } | undefined;
  for (let k = 1; k < variantN; k++) {
    const probability = winFn(control, { n: variantN, conversions: k });
    if (probability === undefined) continue;
    if (!best || Math.abs(probability - target) < Math.abs(best.probability - target)) best = { conversions: k, probability };
  }
  if (!best) throw new RangeError("No achievable conversion count for this target");
  return best;
}

/** Exact Beta-Binomial variant of the target search (a second opinion). */
export const betaBinomialWin = (c: Counts, v: Counts) => probVariantBeatsControl(c, v);

/** Simulated identities are always recognisable. */
export const SIM_PREFIX = "sim-";
export const isSimulated = (identity: string) => identity.startsWith(SIM_PREFIX);
