// Runs the Referee on a LIVE Flagsmith experiment (read-only unless --refresh).
// Usage: npx tsx --env-file=.env.local scripts/referee-live.ts <experimentId> [--refresh] [--real]
//   --refresh  ask Flagsmith to recompute results first (max once per 5 minutes)
//   --real     mark the traffic as real instead of simulated (default: simulated)

import { toSnapshot } from "../lib/flagsmith/adapter";
import { getExperiment, getResults, refreshResults } from "../lib/flagsmith/client";
import { referee } from "../lib/referee";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Pass the experiment id, e.g. 406");
  const synthetic = !process.argv.includes("--real");

  if (process.argv.includes("--refresh")) {
    await refreshResults(id);
    await new Promise((r) => setTimeout(r, 8000));
  }

  const [detail, results] = await Promise.all([getExperiment(id), getResults(id)]);
  const snap = toSnapshot(detail, results, { synthetic });
  const d = referee(snap);

  console.log(`\n${snap.name}  [${snap.source}${snap.synthetic ? ", SIMULATED traffic" : ""}]`);
  console.log(`Verdict: ${d.verdict}${d.winner ? ` (winner: ${d.winner})` : ""}`);
  console.log(d.headline);
  console.log(`Action: ${d.recommendedAction}\n`);
  for (const c of d.checks) console.log(`  [${c.status.toUpperCase()}] ${c.label}\n         ${c.detail}`);
  console.log("\nStill uncertain:");
  for (const u of d.uncertainties) console.log(`  - ${u}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
