import { describe, expect, it } from "vitest";
import { pick } from "./experiment";
import { betaBinomialWin, conversionsForTargetWin, isSimulated, planConversions } from "./simulation";
import { flagsmithWinProbability, probVariantBeatsControl } from "./stats";

const flag = (value: unknown, enabled = true) =>
  ({ enabled, value }) as Parameters<typeof pick>[0];

describe("pick", () => {
  const branches = { control: "Checkout", variant_a: "Buy now" };

  it("returns the branch for the served value", () => {
    expect(pick(flag("variant_a"), branches)).toBe("Buy now");
    expect(pick(flag("control"), branches)).toBe("Checkout");
  });

  it("falls back to control when the flag is missing, disabled, or unknown", () => {
    expect(pick(null, branches)).toBe("Checkout");
    expect(pick(undefined, branches)).toBe("Checkout");
    expect(pick(flag("variant_a", false), branches)).toBe("Checkout");
    expect(pick(flag("something_new"), branches)).toBe("Checkout");
    expect(pick(flag(42), branches)).toBe("Checkout");
  });

  it("is not fooled by prototype keys", () => {
    expect(pick(flag("toString"), branches)).toBe("Checkout");
    expect(pick(flag("__proto__"), branches)).toBe("Checkout");
  });
});

describe("planConversions", () => {
  const people = (arm: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${arm}-${i}`, arm }));

  it("gives each arm exactly round(rate * n) conversions", () => {
    const { converters, perArm } = planConversions(
      [...people("control", 147), ...people("variant_a", 153)],
      (arm) => (arm === "control" ? 0.3 : 0.36),
    );
    expect(perArm.control).toEqual({ n: 147, converted: 44 }); // 44.1
    expect(perArm.variant_a).toEqual({ n: 153, converted: 55 }); // 55.08
    expect(converters.size).toBe(44 + 55);
  });

  it("is deterministic and picks the first identities of each arm", () => {
    const a = people("control", 10);
    const plan1 = planConversions(a, () => 0.3).converters;
    const plan2 = planConversions(a, () => 0.3).converters;
    expect([...plan1]).toEqual([...plan2]);
    expect([...plan1]).toEqual(["control-0", "control-1", "control-2"]);
  });

  it("handles rate 0, rate 1 and an empty input", () => {
    expect(planConversions(people("control", 5), () => 0).converters.size).toBe(0);
    expect(planConversions(people("control", 5), () => 1).converters.size).toBe(5);
    expect(planConversions([], () => 0.5).converters.size).toBe(0);
  });

  it("rejects an impossible rate", () => {
    expect(() => planConversions(people("control", 5), () => 1.2)).toThrow(RangeError);
    expect(() => planConversions(people("control", 5), () => Number.NaN)).toThrow(RangeError);
  });
});

describe("conversionsForTargetWin", () => {
  const control = { n: 400, conversions: 120 };

  it("lands within a point of the requested win probability, using Flagsmith's formula by default", () => {
    for (const target of [0.84, 0.965]) {
      const r = conversionsForTargetWin(control, 400, target);
      expect(Math.abs(r.probability - target)).toBeLessThan(0.01);
      expect(flagsmithWinProbability(control, { n: 400, conversions: r.conversions })).toBeCloseTo(r.probability, 10);
    }
  });

  it("can target the Beta-Binomial method instead, which needs fewer conversions for the same number", () => {
    const flagsmith = conversionsForTargetWin(control, 400, 0.95).conversions;
    const beta = conversionsForTargetWin(control, 400, 0.95, betaBinomialWin).conversions;
    expect(beta).toBeLessThanOrEqual(flagsmith);
    expect(probVariantBeatsControl(control, { n: 400, conversions: beta })).toBeGreaterThan(0.94);
  });

  it("gives more conversions for a higher target", () => {
    expect(conversionsForTargetWin(control, 400, 0.97).conversions).toBeGreaterThan(
      conversionsForTargetWin(control, 400, 0.84).conversions,
    );
  });

  it("rejects an impossible target", () => {
    expect(() => conversionsForTargetWin(control, 400, 1)).toThrow(RangeError);
    expect(() => conversionsForTargetWin(control, 400, 0)).toThrow(RangeError);
  });
});

describe("isSimulated", () => {
  it("recognises simulated identities only", () => {
    expect(isSimulated("sim-abc-1")).toBe(true);
    expect(isSimulated("web-123")).toBe(false);
  });
});
