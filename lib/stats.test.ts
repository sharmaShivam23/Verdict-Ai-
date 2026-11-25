import { describe, expect, it } from "vitest";
import a from "./flagsmith/fixtures/replay-a-84.json";
import b from "./flagsmith/fixtures/replay-b-96.json";
import e from "./flagsmith/fixtures/experiment-406.json";
import { flagsmithWinProbability, normalCdf, probVariantBeatsControl } from "./stats";

type Real = { payload: { metrics: { variants: Record<string, { n: number; sum: number }>; inference: Record<string, { chance_to_win: number }> }[] } };
const real = (r: unknown) => {
  const m = (r as Real).payload.metrics[0];
  return {
    control: { n: m.variants.control.n, conversions: m.variants.control.sum },
    variant: { n: m.variants.Variant_1.n, conversions: m.variants.Variant_1.sum },
    flagsmith: m.inference.Variant_1.chance_to_win,
  };
};
const captures = { "experiment 406": real(e.results), "replay A": real(a.results), "replay B": real(b.results) };

describe("normalCdf", () => {
  it("matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 12);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 6);
    expect(normalCdf(-1.96)).toBeCloseTo(0.0249979, 6);
    expect(normalCdf(1) + normalCdf(-1)).toBeCloseTo(1, 12);
  });
});

describe("flagsmithWinProbability reproduces Flagsmith's REAL chance_to_win", () => {
  for (const [name, c] of Object.entries(captures)) {
    it(`${name}: within 0.001 of what Flagsmith returned (${c.flagsmith.toFixed(4)})`, () => {
      const p = flagsmithWinProbability(c.control, c.variant)!;
      expect(Math.abs(p - c.flagsmith)).toBeLessThan(0.001);
    });
  }

  it("is undefined when a rate is 0 or 1", () => {
    expect(flagsmithWinProbability({ n: 50, conversions: 0 }, { n: 50, conversions: 5 })).toBeUndefined();
    expect(flagsmithWinProbability({ n: 50, conversions: 5 }, { n: 50, conversions: 50 })).toBeUndefined();
  });
});

describe("probVariantBeatsControl is a different (second) method", () => {
  it("differs from Flagsmith by about 2 points on the real replay captures, and is the higher number", () => {
    for (const name of ["replay A", "replay B"] as const) {
      const c = captures[name];
      const exact = probVariantBeatsControl(c.control, c.variant);
      expect(exact - c.flagsmith).toBeGreaterThan(0.01);
      expect(exact - c.flagsmith).toBeLessThan(0.03);
    }
  });

  it("agrees with Flagsmith near 50% (which is why one near-50% test proved nothing)", () => {
    const c = captures["experiment 406"];
    expect(Math.abs(probVariantBeatsControl(c.control, c.variant) - c.flagsmith)).toBeLessThan(0.001);
  });

  it("is exactly symmetric and antisymmetric", () => {
    expect(probVariantBeatsControl({ n: 200, conversions: 50 }, { n: 200, conversions: 50 })).toBeCloseTo(0.5, 10);
    const x = { n: 300, conversions: 80 };
    const y = { n: 280, conversions: 95 };
    expect(probVariantBeatsControl(x, y) + probVariantBeatsControl(y, x)).toBeCloseTo(1, 9);
  });

  it("moves the right way, stays a probability for large samples, rejects impossible input", () => {
    const c = { n: 500, conversions: 100 };
    const ps = [100, 110, 125, 140].map((k) => probVariantBeatsControl(c, { n: 500, conversions: k }));
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThan(ps[i - 1]);
    const big = probVariantBeatsControl({ n: 20000, conversions: 6000 }, { n: 20000, conversions: 6100 });
    expect(big).toBeGreaterThan(0);
    expect(big).toBeLessThanOrEqual(1);
    expect(() => probVariantBeatsControl({ n: 10, conversions: 11 }, { n: 10, conversions: 1 })).toThrow(RangeError);
  });
});
