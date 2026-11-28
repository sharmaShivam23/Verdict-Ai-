import { describe, expect, it } from "vitest";
import { emptyConnection, type Connection } from "../connection";
import { referee } from "../referee";
import { REPLAY_SCENARIOS } from "../replay";
import { applyCleanup } from "./cleanup";
import { riskOf } from "./policy";
import { makeExecutor, ToolInputError, TOOLS, type ToolDeps } from "./tools";

const conn: Connection = { ...emptyConnection(), source: "browser", environmentKey: "ENVKEY12345678", projectId: "56853", flagsmithApiKey: "k" };

function deps(over: Partial<ToolDeps> = {}, c: Connection = conn): ToolDeps {
  return {
    conn: c,
    request: (async () => ({})) as ToolDeps["request"],
    loadDecision: async () => ({ decision: referee(REPLAY_SCENARIOS.A), snapshot: REPLAY_SCENARIOS.A }),
    ...over,
  };
}

const input = { site_type: "react", flag: "hero_cta_test", event: "hero_cta_click", versions: ["start_it"], labels: { control: "Get started free", start_it: "Start it" } };

describe("integration tools: risk and definitions", () => {
  it("are read-only (no approval needed, nothing is changed)", () => {
    expect(riskOf("generate_integration_snippet")).toBe("read");
    expect(riskOf("check_integration")).toBe("read");
  });

  it("are offered to the model", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("generate_integration_snippet");
    expect(names).toContain("check_integration");
  });
});

describe("generate_integration_snippet", () => {
  it("returns React code with the real wording and the env line for the connected project", async () => {
    const out = (await makeExecutor(deps())("generate_integration_snippet", input)) as Record<string, string>;
    expect(out.env_line).toBe("NEXT_PUBLIC_FLAGSMITH_ENVIRONMENT_KEY=ENVKEY12345678");
    expect(out.usage).toContain('{ "control": "Get started free", "start_it": "Start it" }');
    expect(out.provider).toContain("process.env.NEXT_PUBLIC_FLAGSMITH_ENVIRONMENT_KEY");
    expect(out.usage).toContain('useExperiment("hero_cta_test")');
  });

  it("returns plain HTML for any site", async () => {
    const out = (await makeExecutor(deps())("generate_integration_snippet", { ...input, site_type: "html", labels: undefined })) as Record<string, string>;
    expect(out.code).toContain("ENVKEY12345678");
    expect(out.code).toContain("verdictGoal");
  });

  it("generated React code can be cleaned up by the cleanup codemod", async () => {
    const out = (await makeExecutor(deps())("generate_integration_snippet", input)) as Record<string, string>;
    const cleaned = applyCleanup(out.usage, "hero_cta_test", "start_it").code;
    expect(cleaned).toContain('const label = "Start it";');
    expect(cleaned).not.toContain("useExperiment");
    expect(cleaned).not.toContain("pick");
  });

  it("refuses when no project is connected", async () => {
    await expect(makeExecutor(deps({}, emptyConnection()))("generate_integration_snippet", input)).rejects.toThrow(/Connect/);
  });

  it("refuses bad input: control as a version, a bad site type, multi-line wording", async () => {
    const run = (i: unknown) => makeExecutor(deps())("generate_integration_snippet", i);
    await expect(run({ ...input, versions: ["control"] })).rejects.toThrow(ToolInputError);
    await expect(run({ ...input, site_type: "php" })).rejects.toThrow(ToolInputError);
    await expect(run({ ...input, labels: { control: "a\nb" } })).rejects.toThrow(ToolInputError);
  });
});

describe("check_integration", () => {
  const warehouse = (total: number | null) =>
    (async () => [{ total_events_received: total, last_event_received_at: "2026-11-28T00:00:00Z" }]) as unknown as ToolDeps["request"];

  it("reports events arriving", async () => {
    const out = await makeExecutor(deps({ request: warehouse(5) }))("check_integration", {});
    expect(out).toMatchObject({ status: "receiving_events", total_events: 5 });
  });

  it("reports an enabled warehouse with no events yet", async () => {
    expect(await makeExecutor(deps({ request: warehouse(0) }))("check_integration", {})).toMatchObject({ status: "no_events_yet" });
  });

  it("reports when no warehouse is enabled and when nothing is connected", async () => {
    expect(await makeExecutor(deps({ request: (async () => []) as unknown as ToolDeps["request"] }))("check_integration", {})).toMatchObject({ status: "no_warehouse" });
    expect(await makeExecutor(deps({}, emptyConnection()))("check_integration", {})).toMatchObject({ status: "not_connected" });
  });
});
