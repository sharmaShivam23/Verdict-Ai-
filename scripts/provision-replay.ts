// Creates the experiments used to capture REAL replay snapshots (Phase D) by
// calling the SAME executors the agent uses, so it also exercises the live write
// paths. Writes to the Flagsmith environment in .env.local (Development).
// Safe to re-run: existing flags/metric/experiments are reused, not duplicated.
//
// Usage: npx tsx --env-file=.env.local scripts/provision-replay.ts
// Creates: flags replay_checkout_a / replay_checkout_b, metric "Replay conversion",
// one running experiment on each. Saves ids to scripts/.replay-state.json.

import { writeFileSync } from "node:fs";
import { envPath, flagsmithRequest, projectPath } from "../lib/flagsmith/client";
import { executeTool } from "../lib/agent/tools";

interface Created { feature_id?: number; options?: { option_id: number; key: string | null }[]; warning?: string; metric_id?: number; experiment_id?: number; status?: string }
const call = async (name: string, input: unknown) => (await executeTool(name, input)) as Created;
const asList = <T>(r: unknown): T[] => (Array.isArray(r) ? r : ((r as { results?: T[] })?.results ?? [])) as T[];

async function repairKeys(featureId: number, byValue: Record<string, string>) {
  const f = await flagsmithRequest<{ multivariate_options: { id: number; key: string | null; string_value: string }[] }>(
    projectPath(`features/${featureId}/`),
  );
  for (const o of f.multivariate_options) {
    const want = byValue[o.string_value];
    if (!want || o.key === want) continue;
    await flagsmithRequest(projectPath(`features/${featureId}/mv-options/${o.id}/`), {
      method: "PUT",
      body: { type: "unicode", string_value: o.string_value, default_percentage_allocation: 0, key: want, feature: featureId },
    });
    console.log(`flag ${featureId}: option ${o.id} key -> ${want}`);
  }
}

async function main() {
  // Repair the demo flag created earlier: its variation keys were dropped on create.
  await repairKeys(301668, { variant_a: "Variant_1", variant_b: "Variant_2" });

  const flags = asList<{ id: number; name: string; multivariate_options: { id: number; key: string | null; string_value: string }[] }>(
    await flagsmithRequest(projectPath("features/?page_size=100")),
  );
  const metrics = asList<{ id: number; name: string }>(await flagsmithRequest(envPath("experiment-metrics/")));
  const exps = asList<{ id: number; feature: { id: number } | number; status: string }>(await flagsmithRequest(envPath("experiments/")));

  let metricId = metrics.find((m) => m.name === "Replay conversion")?.id;
  if (!metricId) {
    metricId = (await call("create_metric", {
      name: "Replay conversion",
      description: "Conversion event for the replay capture experiments (simulated traffic).",
      event_name: "replay_conversion",
    })).metric_id;
    console.log("created metric", metricId);
  } else console.log("reusing metric", metricId);

  const state: Record<string, unknown> = { metricId, event: "replay_conversion", experiments: {} };
  // B2 replaces B: B's first capture landed at 94.6% by Flagsmith's own formula
  // (under the 95% bar) because it was aimed with a different method.
  // B3 is the clean SHIP scenario: B2 reached 96.3%, above Flagsmith's 95% banner
  // but with its 95% interval still including zero (that needs about 97.5%).
  for (const [label, flag] of [["A", "replay_checkout_a"], ["B", "replay_checkout_b"], ["B2", "replay_checkout_b2"], ["B3", "replay_checkout_b3"]] as const) {
    const f = flags.find((x) => x.name === flag);
    let featureId: number;
    let optionId: number;
    if (f) {
      await repairKeys(f.id, { variant_a: "Variant_1" });
      featureId = f.id;
      optionId = f.multivariate_options[0].id;
      console.log("reusing flag", flag, featureId);
    } else {
      const created = await call("create_feature", { name: flag, variants: [{ key: "Variant_1", value: "variant_a" }] });
      if (created.warning) throw new Error(created.warning);
      featureId = created.feature_id!;
      optionId = created.options![0].option_id;
      console.log("created flag", flag, featureId);
    }

    const exp = exps.find((e) => (typeof e.feature === "number" ? e.feature : e.feature.id) === featureId);
    let experimentId = exp?.id;
    if (!experimentId) {
      experimentId = (await call("create_experiment", {
        feature_id: featureId,
        name: `Replay ${label}: checkout wording`,
        hypothesis: "A benefit-led button label increases checkout clicks (simulated traffic).",
        metric_id: metricId,
        rollout_percentage: 100,
        variant_allocations: [{ option_id: optionId, percentage: 50 }],
      })).experiment_id;
      console.log("created experiment", label, experimentId);
    }
    if (exp?.status !== "running") {
      console.log("start", label, await call("start_experiment", { experiment_id: experimentId }));
    }
    (state.experiments as Record<string, unknown>)[label] = { flag, featureId, experimentId };
  }

  writeFileSync(new URL("./.replay-state.json", import.meta.url), JSON.stringify(state, null, 2));
  console.log("\nSaved scripts/.replay-state.json:", JSON.stringify(state));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
