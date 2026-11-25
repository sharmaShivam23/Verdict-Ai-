// Captures the REAL Flagsmith API responses for an experiment into a replay
// fixture. It only saves once Flagsmith's computed results match the counts you
// expect (so a half-processed warehouse is never captured).
//
// Usage:
//   npx tsx --env-file=.env.local scripts/capture-snapshot.ts <experimentId> <name> \
//       --expect control=55,Variant_1=75 [--exposures control=184,Variant_1=216] [--max-minutes 25]
//
// Writes lib/flagsmith/fixtures/replay-<name>.json (raw detail + results, no secrets).

import { writeFileSync } from "node:fs";
import { envPath, flagsmithRequest, getExperiment, getResults } from "../lib/flagsmith/client";
import type { FlagsmithResults } from "../lib/flagsmith/adapter";

function parseCounts(s: string): Record<string, number> {
  return Object.fromEntries(
    s.split(",").filter(Boolean).map((p) => {
      const [k, v] = p.split("=");
      if (!k || !Number.isInteger(Number(v))) throw new Error(`Bad count "${p}"`);
      return [k, Number(v)];
    }),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [id, name, ...rest] = process.argv.slice(2);
  if (!id || !name || !/^[a-z0-9-]+$/.test(name)) throw new Error("Usage: capture-snapshot.ts <experimentId> <name> --expect control=N,Variant_1=N");
  const flag = (k: string) => {
    const i = rest.indexOf(`--${k}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const expectConv = parseCounts(flag("expect") ?? "");
  const expectN = flag("exposures") ? parseCounts(flag("exposures")!) : undefined;
  if (Object.keys(expectConv).length === 0) throw new Error("--expect is required (conversions per arm)");
  const deadline = Date.now() + Number(flag("max-minutes") ?? 25) * 60_000;

  const matches = (r: FlagsmithResults): boolean => {
    const m = r.results?.payload.metrics[0];
    if (!m) return false;
    return Object.entries(expectConv).every(([arm, c]) => m.variants[arm]?.sum === c) &&
      (!expectN || Object.entries(expectN).every(([arm, n]) => m.variants[arm]?.n === n));
  };

  let lastRefresh = 0;
  for (let attempt = 1; Date.now() < deadline; attempt++) {
    if (Date.now() - lastRefresh > 5.2 * 60_000) {
      try {
        await flagsmithRequest(envPath(`experiments/${id}/results/refresh/`), { method: "POST" });
        lastRefresh = Date.now();
        console.log(`[${attempt}] refresh requested`);
      } catch (e) {
        console.log(`[${attempt}] refresh not accepted: ${(e as Error).message.split("\n")[0]}`);
        lastRefresh = Date.now() - 2 * 60_000; // retry in ~3 minutes
      }
      await sleep(10_000);
    }
    const results = await getResults(id);
    const m = results.results?.payload.metrics[0];
    const seen = m ? Object.entries(m.variants).map(([a, v]) => `${a}: ${v.sum}/${v.n}`).join(", ") : "no results yet";
    console.log(`[${attempt}] ${seen}`);
    if (matches(results)) {
      const detail = await getExperiment(id);
      const fixture = {
        _note: `Captured from the live Flagsmith Admin API on ${new Date().toISOString().slice(0, 10)}. Experiment ${id}, SIMULATED traffic (identities sim-*).`,
        detail,
        results: results.results,
      };
      const file = new URL(`../lib/flagsmith/fixtures/replay-${name}.json`, import.meta.url);
      writeFileSync(file, JSON.stringify(fixture, null, 2));
      console.log(`\nCaptured -> lib/flagsmith/fixtures/replay-${name}.json`);
      console.log(`chance_to_win: ${JSON.stringify(m && Object.fromEntries(Object.entries(m.inference).map(([k, v]) => [k, v.chance_to_win])))}`);
      return;
    }
    await sleep(45_000);
  }
  throw new Error("Timed out before Flagsmith's results matched the expected counts. Nothing was saved.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
