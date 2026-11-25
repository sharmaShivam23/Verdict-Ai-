// Sends SIMULATED visitors to a running Flagsmith experiment. Every identity is
// prefixed "sim-" so it is always distinguishable from real browser visitors
// ("web-"). Disclose simulated traffic in the README and the demo video.
//
// Two passes, so conversion counts are EXACT instead of random:
//   1. every visitor is identified and evaluated (this records the exposure),
//   2. each arm gets round(rate * n_arm) conversions (see lib/simulation.ts).
//
// Usage (from the verdict folder):
//   npx tsx --env-file=.env.local scripts/simulate-traffic.ts [options]
//
// Options (all optional):
//   --flag <name>          default: $FLAGSMITH_FLAG or checkout_cta_test
//   --event <name>         default: $FLAGSMITH_CONVERSION_EVENT or checkout_cta_click
//   --visitors <n>         default: 300
//   --control-rate <0..1>  default: 0.30
//   --variant-rate <0..1>  default: 0.36 (every non-control arm)
//   --rates a=0.4,b=0.5    per-arm override by flag VALUE (e.g. control=0.3,variant_a=0.4)
//   --target-win <0..1>    solve the variant's conversions so the exact win
//                          probability is near this (two-arm tests; uses control rate)
//
// Note: each visitor costs one Flagsmith API request (free plan: 50,000 a month).

import { createFlagsmithInstance } from "@flagsmith/flagsmith";
import {
  conversionsForTargetWin,
  isSimulated,
  planConversions,
  SIM_PREFIX,
  type Assignment,
} from "../lib/simulation";
import { probVariantBeatsControl } from "../lib/stats";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`Unexpected argument "${a}"`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${a}`);
    out[a.slice(2)] = value;
    i++;
  }
  return out;
}

function num(v: string | undefined, fallback: number, name: string): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const environmentID = process.env.FLAGSMITH_ENVIRONMENT_KEY;
  if (!environmentID) throw new Error("FLAGSMITH_ENVIRONMENT_KEY is not set");

  const flagName = args.flag ?? process.env.FLAGSMITH_FLAG ?? "checkout_cta_test";
  const event = args.event ?? process.env.FLAGSMITH_CONVERSION_EVENT ?? "checkout_cta_click";
  const visitors = num(args.visitors, 300, "visitors");
  const controlRate = num(args["control-rate"], 0.3, "control-rate");
  const variantRate = num(args["variant-rate"], 0.36, "variant-rate");
  if (!Number.isInteger(visitors) || visitors < 1) throw new Error("--visitors must be a positive integer");

  const overrides: Record<string, number> = {};
  for (const pair of (args.rates ?? "").split(",").filter(Boolean)) {
    const [arm, r] = pair.split("=");
    if (!arm || r === undefined || !Number.isFinite(Number(r))) throw new Error(`Bad --rates entry "${pair}"`);
    overrides[arm] = Number(r);
  }
  const rateFor = (arm: string) => overrides[arm] ?? (arm === "control" ? controlRate : variantRate);

  const fs = createFlagsmithInstance();
  // Node has no XMLHttpRequest, so hand the SDK Node's built-in fetch.
  await fs.init({ environmentID, enableEvents: true, fetch });

  const run = Date.now().toString(36);
  const assignments: Assignment[] = [];
  let notEnrolled = 0;

  // Pass 1: evaluate (records one exposure per enrolled identity).
  for (let i = 0; i < visitors; i++) {
    const id = `${SIM_PREFIX}${run}-${i}`;
    await fs.identify(id);
    const flag = fs.getExperimentFlag(flagName);
    if (i === 0) console.log("First experiment flag object:", JSON.stringify(flag));
    if (!flag?.experiment?.inExperiment) {
      notEnrolled++;
      continue;
    }
    assignments.push({ id, arm: String(flag.value) });
  }
  if (assignments.length === 0) {
    throw new Error(
      `No visitor was enrolled in an experiment on "${flagName}". Is the experiment running, and is rollout above 0%?`,
    );
  }

  // Pass 2: exact conversion quotas per arm. With --target-win the variant's
  // quota is solved so the exact win probability lands near the target.
  let effectiveRate = rateFor;
  if (args["target-win"] !== undefined) {
    const target = num(args["target-win"], 0, "target-win");
    const n = (arm: string) => assignments.filter((a) => a.arm === arm).length;
    const nControl = n("control");
    const nVariant = assignments.length - nControl;
    if (nControl === 0 || nVariant === 0) throw new Error("--target-win needs visitors in both arms");
    const controlConv = Math.round(rateFor("control") * nControl);
    const solved = conversionsForTargetWin({ n: nControl, conversions: controlConv }, nVariant, target);
    console.log(`Targeting ${(target * 100).toFixed(1)}% win by Flagsmith's formula: variant gets ${solved.conversions}/${nVariant} (${(solved.probability * 100).toFixed(1)}%).`);
    effectiveRate = (arm) => (arm === "control" ? controlConv / nControl : solved.conversions / nVariant);
  }
  const { converters, perArm } = planConversions(assignments, effectiveRate);
  for (const id of converters) {
    if (!isSimulated(id)) throw new Error("Refusing to convert a non-simulated identity");
    fs.trackEvent(event, { identifier: id });
  }

  // Events are batched; flush before exit or they are lost.
  await fs.flushEvents();

  console.log(`\nSent ${visitors} simulated visitors on "${flagName}" (ids ${SIM_PREFIX}${run}-*), event "${event}".`);
  if (notEnrolled > 0) console.log(`${notEnrolled} were outside the experiment's rollout and were not counted.`);
  console.table(
    Object.fromEntries(
      Object.entries(perArm).map(([arm, v]) => [
        arm,
        { enrolled: v.n, converted: v.converted, rate: (v.converted / v.n).toFixed(3) },
      ]),
    ),
  );

  const control = perArm.control;
  const others = Object.entries(perArm).filter(([arm]) => arm !== "control");
  if (control && others.length === 1) {
    const [, v] = others[0];
    const p = probVariantBeatsControl(
      { n: control.n, conversions: control.converted },
      { n: v.n, conversions: v.converted },
    );
    console.log(`Independent audit preview: P(variant beats control) = ${(p * 100).toFixed(1)}% for this run alone.`);
    console.log("(Flagsmith's number covers ALL traffic so far, including earlier runs.)");
  }
  console.log("\nWait for the warehouse to process events, then refresh results (limit: once per 5 minutes).");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
