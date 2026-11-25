// Prepares the experiment on the REAL demo flag (checkout_cta_test) so the full
// lifecycle can be run: traffic -> SHIP -> complete -> cleanup PR.
// Uses the same executors as the agent. Idempotent: reuses what already exists.
// Writes to the Flagsmith environment in .env.local (Development).
//
// Usage: npx tsx --env-file=.env.local scripts/provision-demo.ts

import { envPath, flagsmithRequest, projectPath } from "../lib/flagsmith/client";
import { executeTool } from "../lib/agent/tools";

type R = { metric_id?: number; experiment_id?: number; status?: string };
const call = async (name: string, input: unknown) => (await executeTool(name, input)) as R;
const list = <T>(r: unknown): T[] => (Array.isArray(r) ? r : ((r as { results?: T[] })?.results ?? [])) as T[];

async function main() {
  const flagName = "checkout_cta_test";
  const flags = list<{ id: number; name: string; multivariate_options: { id: number; key: string | null; string_value: string }[] }>(
    await flagsmithRequest(projectPath("features/?page_size=100")),
  );
  const flag = flags.find((f) => f.name === flagName);
  if (!flag) throw new Error(`Flag ${flagName} not found`);
  const opt = flag.multivariate_options.find((o) => o.string_value === "variant_a");
  if (!opt?.key) throw new Error("variant_a has no key; run scripts/provision-replay.ts once to repair keys");

  // Flagsmith rejects an experiment that omits any of the flag's variations
  // ("Must include all feature's variants"). The demo page only uses variant_a,
  // so drop the unused extra variation created during the first manual test.
  const extras = flag.multivariate_options.filter((o) => o.id !== opt.id);
  const alreadyRunning = list<{ feature: { id: number } | number }>(await flagsmithRequest(envPath("experiments/"))).some(
    (e) => (typeof e.feature === "number" ? e.feature : e.feature.id) === flag.id,
  );
  if (extras.length > 0 && !alreadyRunning) {
    for (const x of extras) {
      console.log(`removing unused variation option ${x.id} (${x.string_value}) from ${flagName}`);
      await flagsmithRequest(projectPath(`features/${flag.id}/mv-options/${x.id}/`), { method: "DELETE" });
    }
  }

  const metrics = list<{ id: number; name: string }>(await flagsmithRequest(envPath("experiment-metrics/")));
  let metricId = metrics.find((m) => m.name === "Checkout click")?.id;
  if (!metricId) {
    metricId = (await call("create_metric", {
      name: "Checkout click",
      description: "Visitor clicked the checkout button on /demo.",
      event_name: "checkout_cta_click",
    })).metric_id;
    console.log("created metric", metricId);
  } else console.log("reusing metric", metricId);

  const exps = list<{ id: number; status: string; feature: { id: number } | number }>(await flagsmithRequest(envPath("experiments/")));
  const existing = exps.find((e) => (typeof e.feature === "number" ? e.feature : e.feature.id) === flag.id);
  let experimentId = existing?.id;
  if (!experimentId) {
    experimentId = (await call("create_experiment", {
      feature_id: flag.id,
      name: "Checkout wording (demo)",
      hypothesis: "Buy now, free returns gets more checkout clicks than Checkout within a few days (simulated traffic).",
      metric_id: metricId,
      rollout_percentage: 100,
      variant_allocations: [{ option_id: opt.id, percentage: 50 }],
    })).experiment_id;
    console.log("created experiment", experimentId);
  } else console.log("reusing experiment", experimentId, existing?.status);

  if (existing?.status !== "running") console.log("start", await call("start_experiment", { experiment_id: experimentId }));
  console.log(`\nREADY: experiment ${experimentId} on ${flagName}, variant option id ${opt.id}, metric event checkout_cta_click`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
