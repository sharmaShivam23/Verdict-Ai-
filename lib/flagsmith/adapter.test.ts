import { describe, expect, it } from "vitest";
import { referee } from "../referee";
import { NoResultsYetError, toSnapshot, UnsupportedMetricError } from "./adapter";
import fixture from "./fixtures/experiment-406.json";

const detail = fixture.detail as Parameters<typeof toSnapshot>[0];
// The fixture stores the inner object; the API wraps it as { results: ... }.
const results = { results: fixture.results } as unknown as Parameters<typeof toSnapshot>[1];
const now = new Date("2026-11-24T05:15:00Z");

describe("Flagsmith adapter (real captured payload)", () => {
  const snap = toSnapshot(detail, results, { synthetic: true, now });

  it("maps arms, exposures, conversions and configured shares", () => {
    const control = snap.arms.find((a) => a.isControl)!;
    const variant = snap.arms.find((a) => !a.isControl)!;
    expect(control).toMatchObject({ name: "control", exposures: 147, conversions: 43, configuredShare: 0.5 });
    expect(variant).toMatchObject({ name: "Variant_1", exposures: 153, conversions: 46, configuredShare: 0.5 });
    expect(variant.winProbability).toBeCloseTo(0.5602, 3);
    expect(variant.ciLow).toBeLessThan(0);
    expect(variant.ciHigh).toBeGreaterThan(0);
  });

  it("labels the snapshot live and synthetic", () => {
    expect(snap.source).toBe("live");
    expect(snap.synthetic).toBe(true);
    expect(snap.primaryMetric).toBe("Test Conversion");
  });

  it("Referee says KEEP_RUNNING at 56% and our own SRM check passes", () => {
    const d = referee(snap);
    expect(d.verdict).toBe("KEEP_RUNNING");
    expect(d.checks.find((c) => c.id === "srm")?.status).toBe("pass");
    expect(d.checks.find((c) => c.id === "sample")?.status).toBe("pass");
    expect(d.checks.find((c) => c.id === "winprob")?.status).toBe("fail");
    // Real Flagsmith output (56.02%) is reproduced by the independent calculation.
    expect(d.checks.find((c) => c.id === "audit")?.status).toBe("pass");
  });

  it("refuses a lower-is-better primary metric instead of risking a wrong verdict", () => {
    const lower = structuredClone(detail);
    lower.metrics[0].expected_direction = "decrease";
    expect(() => toSnapshot(lower, results, { synthetic: true, now })).toThrow(UnsupportedMetricError);
  });

  it("throws a clear error while Flagsmith has no results yet", () => {
    expect(() => toSnapshot(detail, { results: null }, { synthetic: true })).toThrow(
      NoResultsYetError,
    );
  });
});
