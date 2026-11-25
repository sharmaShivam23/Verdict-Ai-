// Small statistics helpers used by the Referee. Pure functions, no I/O.

/** Regularised upper incomplete gamma Q(a, x), used for the chi-square tail. */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const gln = lnGamma(a);
  if (x < a + 1) {
    // Series for P(a, x), then Q = 1 - P.
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  // Continued fraction for Q(a, x) (modified Lentz).
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

export function lnGamma(z: number): number {
  // Lanczos approximation.
  const g = 7;
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = coef[0];
  for (let i = 1; i < g + 2; i++) x += coef[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Upper-tail p-value of a chi-square statistic with `df` degrees of freedom. */
export function chiSquarePValue(stat: number, df: number): number {
  return gammaQ(df / 2, stat / 2);
}

const lnBeta = (a: number, b: number) => lnGamma(a) + lnGamma(b) - lnGamma(a + b);

/**
 * Exact P(p_variant > p_control) for two conversion rates with independent
 * uniform Beta(1,1) priors, given identities and conversions per arm. Uses the
 * closed-form sum for integer Beta parameters (Evan Miller, "Formulas for
 * Bayesian A/B Testing"), computed in log space. Deterministic: no sampling.
 *
 * This is a SECOND METHOD, not a reproduction of Flagsmith: on real captures it
 * differs from Flagsmith's number by up to 2 points (see flagsmithWinProbability
 * for the formula Flagsmith actually uses).
 */
export function probVariantBeatsControl(
  control: { n: number; conversions: number },
  variant: { n: number; conversions: number },
): number {
  const aA = 1 + control.conversions;
  const bA = 1 + control.n - control.conversions;
  const aB = 1 + variant.conversions;
  const bB = 1 + variant.n - variant.conversions;
  if (bA < 1 || bB < 1) throw new RangeError("conversions cannot exceed identities");

  const base = lnBeta(aA, bA);
  let p = 0;
  for (let i = 0; i < aB; i++) {
    p += Math.exp(lnBeta(aA + i, bA + bB) - Math.log(bB + i) - lnBeta(1 + i, bB) - base);
  }
  return Math.min(1, Math.max(0, p));
}

/** Standard normal CDF, via the regularised incomplete gamma (erfc(x) = Q(1/2, x^2)). */
export function normalCdf(z: number): number {
  const tail = 0.5 * gammaQ(0.5, (z * z) / 2); // P(Z > |z|)
  return z >= 0 ? 1 - tail : tail;
}

/**
 * Reproduces the "chance to win" that Flagsmith reports: a normal approximation
 * on the RELATIVE lift (delta method), P = Phi(lift / se) with
 *   se = (pv/pc) * sqrt((1-pv)/(nv*pv) + (1-pc)/(nc*pc)).
 * Found by fitting Flagsmith's own captured results (its interval is symmetric
 * around the lift, lift +/- 1.96*se). Matches all three real captures to within
 * 0.0006. Returns undefined when a rate is 0 or 1 (the formula is undefined).
 */
export function flagsmithWinProbability(
  control: { n: number; conversions: number },
  variant: { n: number; conversions: number },
): number | undefined {
  const pc = control.conversions / control.n;
  const pv = variant.conversions / variant.n;
  if (!(pc > 0 && pc < 1 && pv > 0 && pv < 1)) return undefined;
  const ratio = pv / pc;
  const se = ratio * Math.sqrt((1 - pv) / (variant.n * pv) + (1 - pc) / (control.n * pc));
  return normalCdf((ratio - 1) / se);
}

export interface SrmResult {
  chiSquare: number;
  df: number;
  pValue: number;
  total: number;
}

/**
 * Sample ratio mismatch test: do observed exposure counts match the
 * configured split? Shares are normalised so they always sum to 1.
 */
export function sampleRatioMismatch(
  observed: number[],
  shares: number[],
): SrmResult {
  const total = observed.reduce((a, b) => a + b, 0);
  const shareSum = shares.reduce((a, b) => a + b, 0);
  let chi = 0;
  for (let i = 0; i < observed.length; i++) {
    const expected = (total * shares[i]) / shareSum;
    if (expected > 0) chi += (observed[i] - expected) ** 2 / expected;
  }
  const df = observed.length - 1;
  return { chiSquare: chi, df, pValue: chiSquarePValue(chi, df), total };
}
