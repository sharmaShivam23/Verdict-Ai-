// Read-only probe: prints the raw JSON the Flagsmith Admin API returns for an
// experiment, so the adapter can be built on real data. Never prints the key.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-results.ts <experimentId> [path]
// Default path is "results/". Only GET requests are made.

const apiKey = process.env.FLAGSMITH_API_KEY;
const envKey = process.env.FLAGSMITH_ENVIRONMENT_KEY;
const experimentId = process.argv[2];
// "-" means the experiment detail endpoint itself (shells drop empty arguments).
const subPath = process.argv[3] === "-" ? "" : (process.argv[3] ?? "results/");

if (!apiKey) throw new Error("FLAGSMITH_API_KEY is not set");
if (!envKey) throw new Error("FLAGSMITH_ENVIRONMENT_KEY is not set");
if (!experimentId) throw new Error("Pass the experiment id, e.g. 406");

const base = process.env.FLAGSMITH_API_URL ?? "https://api.flagsmith.com/api/v1";
const url = `${base}/environments/${envKey}/experiments/${experimentId}/${subPath}`;

async function main() {
  // Default is GET. PROBE_METHOD=POST is only for the results/refresh/ trigger.
  const res = await fetch(url, {
    method: process.env.PROBE_METHOD ?? "GET",
    // Organisation API keys use "Api-Key"; personal account tokens use "Token".
    headers: {
      Authorization: `${process.env.FLAGSMITH_AUTH_SCHEME ?? "Api-Key"} ${apiKey}`,
    },
  });
  const text = await res.text();
  console.log(`GET .../experiments/${experimentId}/${subPath} -> HTTP ${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text.slice(0, 2000));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
