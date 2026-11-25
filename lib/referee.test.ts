import { describe, expect, it } from "vitest";
import { referee } from "./referee";
import { REPLAY_SCENARIOS } from "./replay";
import { chiSquarePValue, sampleRatioMismatch } from "./stats";
import type { ArmStats, ExperimentSnapshot } from "./types";

const clone = (k: keyof typeof REPLAY_SCENARIOS) => structuredClone(REPLAY_SCENARIOS[k]);
const arm = (s: ExperimentSnapshot, control: boolean): ArmStats => s.arms.find((a) => a.isControl === control)!;
const check = (s: ExperimentSnapshot, id: string) => referee(s).checks.find((c) => c.id === id);

describe("stats", () => {
  it("chi-square tail matches known values", () => {
    expect(chiSquarePValue(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(10.828, 1)).toBeCloseTo(0.001, 4);
    expect(chiSquarePValue(5.991, 2)).toBeCloseTo(0.05, 3);
  });

  it("flags a lopsided 50/50 split and passes a balanced one", () => {
    expect(sampleRatioMismatch([500, 380], [0.5, 0.5]).pValue).toBeLessThan(0.001);
    expect(sampleRatioMismatch([247, 255], [0.5, 0.5]).pValue).toBeGreaterThan(0.5);
  });
});

describe("replay scenarios (real Flagsmith captures, except C)", () => {
  it("are labelled replay and simulated, and only C is constructed", () => {
    for (const k of ["A", "B", "C", "D"] as const) {
      expect(REPLAY_SCENARIOS[k].source).toBe("replay");
      expect(REPLAY_SCENARIOS[k].synthetic).toBe(true);
    }
    expect(REPLAY_SCENARIOS.A.constructed).toBeUndefined();
    expect(REPLAY_SCENARIOS.B.constructed).toBeUndefined();
    expect(REPLAY_SCENARIOS.D.constructed).toBeUndefined();
    expect(REPLAY_SCENARIOS.C.constructed).toBe(true);
  });

  it("A: 82.8% -> KEEP_RUNNING", () => {
    const d = referee(REPLAY_SCENARIOS.A);
    expect(d.verdict).toBe("KEEP_RUNNING");
    expect(d.winner).toBeUndefined();
    expect(d.checks.find((c) => c.id === "winprob")?.status).toBe("fail");
    expect(d.headline).toMatch(/83%/);
  });

  it("B: clears every bar -> SHIP with all checks passing", () => {
    const d = referee(REPLAY_SCENARIOS.B);
    expect(d.verdict).toBe("SHIP");
    expect(d.winner).toBe("Variant_1");
    expect(d.checks.every((c) => c.status === "pass")).toBe(true);
    expect(d.uncertainties.length).toBeGreaterThan(0);
  });

  it("C: broken split -> INVALID even though the win probability looks great and the interval excludes zero", () => {
    const d = referee(REPLAY_SCENARIOS.C);
    expect(d.verdict).toBe("INVALID");
    expect(d.checks.find((c) => c.id === "srm")?.status).toBe("fail");
    expect(d.checks.find((c) => c.id === "winprob")?.status).toBe("pass");
    expect(d.checks.find((c) => c.id === "interval")?.status).toBe("pass");
  });

  it("D: 96.3% clears Flagsmith's 95% bar but the interval includes zero -> KEEP_RUNNING with a precise explanation", () => {
    const d = referee(REPLAY_SCENARIOS.D);
    expect(d.verdict).toBe("KEEP_RUNNING");
    expect(d.checks.find((c) => c.id === "winprob")?.status).toBe("pass");
    expect(d.checks.find((c) => c.id === "interval")?.status).toBe("fail");
    expect(d.headline).toMatch(/clears the 95% bar/);
    expect(d.headline).toMatch(/includes zero/);
    expect(d.recommendedAction).toMatch(/97\.5%/);
  });
});

describe("referee audit of Flagsmith's number", () => {
  it("reproduces Flagsmith's number on every real capture", () => {
    for (const k of ["A", "B", "D"] as const) {
      const audit = referee(REPLAY_SCENARIOS[k]).checks.find((c) => c.id === "audit")!;
      expect(audit.status, k).toBe("pass");
      expect(audit.detail).toMatch(/Flagsmith's own formula/);
    }
  });

  it("BLOCKS shipping when Flagsmith claims a win its own counts do not support", () => {
    const s = clone("B");
    const c = arm(s, true);
    const v = arm(s, false);
    v.conversions = Math.round((c.conversions / c.exposures) * v.exposures); // same rate as control
    // Flagsmith still claims 98% with an interval above zero:
    expect(v.winProbability).toBeGreaterThan(0.95);
    const d = referee(s);
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(d.headline).toMatch(/disagree/);
    expect(d.checks.find((c) => c.id === "audit")?.status).toBe("fail");
  });

  it("tolerates a tiny rounding gap but not a 2-point gap", () => {
    const small = clone("B");
    arm(small, false).winProbability! -= 0.003;
    expect(check(small, "audit")?.status).toBe("pass");
    const big = clone("B");
    arm(big, false).winProbability! -= 0.02;
    expect(check(big, "audit")?.status).toBe("fail");
  });

  it("says plainly when it cannot audit (several variations) and does not block", () => {
    const s = clone("B");
    s.arms.push({ ...arm(s, false), name: "second", winProbability: 0.5, lift: 0, ciLow: -0.1, ciHigh: 0.1, conversions: 60 });
    s.arms.forEach((a) => (a.configuredShare = 1 / 3));
    const audit = check(s, "audit")!;
    expect(audit.status).toBe("warn");
    expect(audit.detail).toMatch(/two-arm/);
  });

  it("does not audit non-occurrence metrics", () => {
    const s = clone("B");
    s.primaryAggregation = "sum";
    const audit = check(s, "audit")!;
    expect(audit.status).toBe("warn");
    expect(audit.detail).toMatch(/occurrence/);
  });

  it("reports the Beta-Binomial cross-check as informational", () => {
    expect(check(REPLAY_SCENARIOS.B, "winprob")?.detail).toMatch(/Beta-Binomial.*informational/);
  });
});

describe("referee edge cases", () => {
  it("does not ship when a guardrail is violated", () => {
    const s = clone("B");
    s.guardrails = [{ name: "bounce_rate", direction: "should_not_increase", delta: 0.1, ciLow: 0.03, ciHigh: 0.17 }];
    expect(referee(s).verdict).toBe("INCONCLUSIVE");
  });

  it("keeps running when the sample is too thin, even at a high win probability", () => {
    const s = clone("B");
    arm(s, true).exposures = 30;
    arm(s, false).exposures = 30;
    arm(s, true).conversions = 3;
    expect(referee(s).verdict).toBe("KEEP_RUNNING");
  });

  it("recommends keeping control when every variation is probably worse", () => {
    const s = clone("A");
    const v = arm(s, false);
    v.winProbability = 0.03;
    v.lift = -0.2;
    v.ciLow = -0.4;
    v.ciHigh = -0.01;
    const d = referee(s);
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(d.recommendedAction).toMatch(/keep the control/i);
  });

  it("is INVALID when Flagsmith itself raises the SRM warning", () => {
    const s = clone("B");
    s.flagsmithSrmWarning = true;
    expect(referee(s).verdict).toBe("INVALID");
  });
});
