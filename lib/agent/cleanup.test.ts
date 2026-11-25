import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyCleanup,
  CleanupError,
  findReferences,
  isAllowedCleanupPath,
  keptBranchFor,
  prBody,
  unifiedDiff,
} from "./cleanup";
import { referee } from "../referee";
import { REPLAY_SCENARIOS } from "../replay";

const FILE = `"use client";

import { useExperiment, useFlagsmith } from "@flagsmith/flagsmith/react";
import { useState } from "react";
import { pick } from "@/lib/experiment";

export default function B() {
  const flagsmith = useFlagsmith();
  const label = pick(useExperiment("my_flag"), { control: "Checkout", variant_a: "Buy now, free returns" });
  return <button onClick={() => flagsmith.trackEvent("x")}>{label}</button>;
}
`;

describe("applyCleanup (the codemod)", () => {
  it("keeps the winning branch and removes the unused imports", () => {
    const r = applyCleanup(FILE, "my_flag", "variant_a");
    expect(r.code).toContain('const label = "Buy now, free returns";');
    expect(r.code).not.toContain("useExperiment");
    expect(r.code).not.toContain("pick");
    expect(r.code).not.toContain("@/lib/experiment");
    expect(r.code).toContain('import { useFlagsmith } from "@flagsmith/flagsmith/react";'); // still used, so kept
    expect(r.code).toContain('import { useState } from "react";'); // untouched
    expect(r.replacements).toBe(1);
  });

  it("keeps the control branch when control won", () => {
    expect(applyCleanup(FILE, "my_flag", "control").code).toContain('const label = "Checkout";');
  });

  it("keeps an import that is still used elsewhere", () => {
    const src = FILE.replace("return <button", 'const y = pick(null, { control: 1 });\n  return <button');
    const r = applyCleanup(src, "my_flag", "control");
    expect(r.code).toContain('import { pick } from "@/lib/experiment";');
    expect(r.code).not.toMatch(/import \{[^}]*useExperiment/);
  });

  it("handles single quotes, quoted keys, newlines and a trailing comma", () => {
    const src = `import { useExperiment } from "x";\nconst l = pick(\n  useExperiment('my_flag'),\n  {\n    'control': 'A \\'q\\'',\n    "variant_a": "B",\n  },\n);\n`;
    const r = applyCleanup(src, "my_flag", "control");
    expect(r.code).toContain(`const l = "A 'q'";`);
    expect(r.code).not.toContain("import { useExperiment }");
  });

  it("handles several calls for the same flag", () => {
    const two = `${FILE}\nconst b = pick(useExperiment("my_flag"), { control: "x", variant_a: "y" });\n`;
    expect(applyCleanup(two, "my_flag", "variant_a").replacements).toBe(2);
  });

  it("is a no-op for other flags and refuses when nothing matches", () => {
    expect(() => applyCleanup(FILE, "other_flag", "control")).toThrow(CleanupError);
  });

  it("refuses shapes it does not understand instead of guessing", () => {
    const tpl = "const l = pick(useExperiment(\"my_flag\"), { control: `a${1}`, variant_a: \"b\" });";
    expect(() => applyCleanup(tpl, "my_flag", "control")).toThrow(/plain string/);
    const expr = 'const l = pick(useExperiment("my_flag"), { control: foo(), variant_a: "b" });';
    expect(() => applyCleanup(expr, "my_flag", "control")).toThrow(CleanupError);
    const third = 'const l = pick(useExperiment("my_flag"), { control: "a" }, 3);';
    expect(() => applyCleanup(third, "my_flag", "control")).toThrow(/third argument/);
  });

  it("refuses when the kept value is not a branch, or control is missing", () => {
    expect(() => applyCleanup(FILE, "my_flag", "variant_z")).toThrow(/no "variant_z"/);
    const noControl = 'const l = pick(useExperiment("my_flag"), { variant_a: "b" });';
    expect(() => applyCleanup(noControl, "my_flag", "variant_a")).toThrow(/control/);
  });

  it("rejects a flag name that could break out of the pattern", () => {
    expect(() => applyCleanup(FILE, 'a")|(', "control")).toThrow(/Unsupported flag name/);
  });

  it("works on the REAL demo file in this repo", () => {
    const real = readFileSync("app/demo/checkout-button.tsx", "utf8");
    const r = applyCleanup(real, "checkout_cta_test", "variant_a");
    expect(r.code).toContain('const label = "Buy now, free returns";');
    expect(r.code).not.toContain("useExperiment"); // no import, no call, no mention
    expect(r.code).not.toContain("@/lib/experiment");
    expect(r.code).toContain("useFlagsmith"); // still needed for trackEvent
    expect(r.code).toContain("trackEvent");
  });
});

describe("keptBranchFor (derived from the recorded decision)", () => {
  const feature = { name: "f", multivariate_options: [{ id: 7, string_value: "variant_a" }] };

  it("needs a recorded decision and a finished experiment", () => {
    expect(keptBranchFor({ feature, status: "completed", rollout_decision: null }).ok).toBe(false);
    expect(keptBranchFor({ feature, status: "running", rollout_decision: "control" }).ok).toBe(false);
    expect(keptBranchFor({ feature, status: "paused", rollout_decision: "variant", rollout_variant: 7 }).ok).toBe(false);
  });

  it("keeps control or the rolled-out variation's VALUE", () => {
    expect(keptBranchFor({ feature, status: "completed", rollout_decision: "control" })).toMatchObject({ ok: true, keepValue: "control" });
    expect(keptBranchFor({ feature, status: "completed", rollout_decision: "variant", rollout_variant: 7 })).toMatchObject({
      ok: true,
      keepValue: "variant_a",
    });
  });

  it("refuses 'disable' and an unknown variation", () => {
    expect(keptBranchFor({ feature, status: "completed", rollout_decision: "disable" }).ok).toBe(false);
    expect(keptBranchFor({ feature, status: "completed", rollout_decision: "variant", rollout_variant: 99 }).ok).toBe(false);
  });
});

describe("path allow-list", () => {
  it("only allows files under app/demo/", () => {
    expect(isAllowedCleanupPath("app/demo/checkout-button.tsx")).toBe(true);
    for (const bad of ["lib/referee.ts", "app/page.tsx", "app/demo/../page.tsx", "../x.ts", "/etc/passwd", "app/demo/x.js.map", "app/demo//a.tsx", ".env.local", "app/demo/a b.tsx"]) {
      expect(isAllowedCleanupPath(bad), bad).toBe(false);
    }
  });
});

describe("findReferences", () => {
  it("finds the flag with line numbers", () => {
    const hits = findReferences([{ path: "app/demo/a.tsx", content: FILE }], "my_flag");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: "app/demo/a.tsx", line: 9 });
    expect(findReferences([{ path: "p", content: FILE }], "nope")).toEqual([]);
  });
});

describe("unifiedDiff and prBody", () => {
  it("shows only the changed lines with context", () => {
    const after = applyCleanup(FILE, "my_flag", "variant_a").code;
    const d = unifiedDiff("app/demo/a.tsx", FILE, after);
    expect(d).toContain("--- a/app/demo/a.tsx");
    expect(d).toContain('-  const label = pick(useExperiment("my_flag")');
    expect(d).toContain('+  const label = "Buy now, free returns";');
    expect(unifiedDiff("p", FILE, FILE)).toBe("");
  });

  it("PR body carries the Referee verdict and the simulated-traffic disclosure", () => {
    const snap = REPLAY_SCENARIOS.B;
    const body = prBody({ flag: "my_flag", experimentId: 5, keptValue: "variant_a", filePath: "app/demo/a.tsx", decision: referee(snap), snapshot: snap });
    expect(body).toMatch(/Verdict: SHIP/);
    expect(body).toMatch(/SIMULATED/);
    expect(body).toMatch(/Still uncertain/);
    expect(prBody({ flag: "f", experimentId: 1, keptValue: "control", filePath: "app/demo/a.tsx" })).toMatch(/could not be loaded/);
  });
});
