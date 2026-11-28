import { describe, expect, it } from "vitest";
import { applyCleanup } from "./agent/cleanup";
import { htmlSnippet, reactSnippets, SDK_CDN, validateSnippetInput, type SnippetInput } from "./snippets";

const input: SnippetInput = { environmentKey: "kPxYj4HBBrwQQzxBK3oCaC", flag: "site_theme", event: "sign_up_click", versions: ["white", "yellow"] };

describe("validateSnippetInput", () => {
  it("accepts good input and trims version names", () => {
    const v = validateSnippetInput({ ...input, versions: [" white ", "yellow", ""] });
    expect(v.ok && v.value.versions).toEqual(["white", "yellow"]);
  });

  it("rejects anything that could break out of the generated code", () => {
    for (const bad of [
      { ...input, flag: 'x"; alert(1); //' },
      { ...input, event: "a b" },
      { ...input, environmentKey: "abc'def" },
      { ...input, versions: ["ok", '"><script>'] },
      { ...input, flag: "" },
    ]) {
      expect(validateSnippetInput(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("explains the control rule, duplicates and an empty list", () => {
    expect(validateSnippetInput({ ...input, versions: ["control"] })).toMatchObject({ ok: false, error: expect.stringMatching(/control/) });
    expect(validateSnippetInput({ ...input, versions: ["a", "a"] })).toMatchObject({ ok: false });
    expect(validateSnippetInput({ ...input, versions: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/at least one/) });
  });
});

describe("htmlSnippet", () => {
  const code = htmlSnippet(input);

  it("loads the pinned SDK and wires exposure, identity and the goal event", () => {
    expect(code).toContain(SDK_CDN);
    expect(code).toContain('"kPxYj4HBBrwQQzxBK3oCaC"');
    expect(code).toContain("createFlagsmithInstance");
    expect(code).toContain("enableEvents: true");
    expect(code).toContain("getExperimentFlag(FLAG)");
    expect(code).toContain("trackEvent(GOAL)");
    expect(code).toContain("flushEvents()");
  });

  it("has CSS for the control and every new version", () => {
    for (const v of ["control", "white", "yellow"]) expect(code).toContain(`[data-version="${v}"]`);
  });

  it("the inline script is valid JavaScript", () => {
    const js = /<script>\n([\s\S]*?)<\/script>/.exec(code)![1];
    expect(() => new Function(js)).not.toThrow();
  });
});

describe("reactSnippets", () => {
  const s = reactSnippets(input);

  it("includes control and each version as branches, keyed by the flag value", () => {
    expect(s.usage).toContain('"control": "control", "white": "white", "yellow": "yellow"');
    expect(s.usage).toContain('useExperiment("site_theme")');
    expect(s.usage).toContain('trackEvent("sign_up_click")');
  });

  it("uses real wording when given, so the code is ready to paste", () => {
    const r = reactSnippets({ ...input, versions: ["start_it"], labels: { control: "Get started free", start_it: "Start it" } });
    expect(r.usage).toContain('{ "control": "Get started free", "start_it": "Start it" }');
    expect(r.envLine).toBe(`NEXT_PUBLIC_FLAGSMITH_ENVIRONMENT_KEY=${input.environmentKey}`);
  });

  it("uses the one pattern the cleanup tool can remove (checked with the real codemod)", () => {
    const cleaned = applyCleanup(s.usage, "site_theme", "yellow");
    expect(cleaned.code).toContain('const label = "yellow";');
    expect(cleaned.code).not.toContain("useExperiment");
    expect(cleaned.code).not.toContain("@/lib/experiment");
    expect(cleaned.code).toContain("FlagsmithContext"); // still needed for trackEvent
  });
});
