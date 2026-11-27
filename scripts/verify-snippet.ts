// Proves the website snippet really works against real Flagsmith: runs the
// GENERATED plain-HTML snippet in a sandbox that behaves like a browser page,
// then checks that Flagsmith's event counter went up.
//
// The visitor id is "sim-..." so the data stays honestly labelled as simulated.
// Usage: npx tsx --env-file=.env.local scripts/verify-snippet.ts [flag] [event]

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { connectionFromEnv } from "../lib/connection";
import { envPath, flagsmithRequest } from "../lib/flagsmith/client";
import { htmlSnippet, validateSnippetInput } from "../lib/snippets";

const conn = connectionFromEnv();
const flag = process.argv[2] ?? "website_theme";
const event = process.argv[3] ?? "sign_up_click";

const counters = async () => {
  const w = await flagsmithRequest<{ total_events_received?: number | null; last_event_received_at?: string | null }[]>(
    envPath("warehouse-connections/", conn),
    {},
    conn,
  );
  return { total: w[0]?.total_events_received ?? 0, last: w[0]?.last_event_received_at ?? null };
};

/** Minimal XMLHttpRequest on top of fetch: browsers have one, Node does not. */
class XHRShim {
  method = "GET"; url = ""; headers: Record<string, string> = {};
  status = 0; statusText = ""; responseText = ""; responseURL = ""; withCredentials = false;
  onload: (() => void) | null = null; onerror: (() => void) | null = null;
  open(m: string, u: string) { this.method = m; this.url = u; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  getAllResponseHeaders() { return ""; }
  send(body?: string) {
    fetch(this.url, { method: this.method, headers: this.headers, body })
      .then(async (r) => { this.status = r.status; this.statusText = r.statusText; this.responseURL = r.url; this.responseText = await r.text(); this.onload?.(); })
      .catch(() => this.onerror?.());
  }
}

async function main() {
  const v = validateSnippetInput({ environmentKey: conn.environmentKey ?? "", flag, event, versions: ["x"] });
  if (!v.ok) throw new Error(v.error);
  const code = htmlSnippet(v.value);
  const script = /<script>\n([\s\S]*?)<\/script>/.exec(code)![1];

  const before = await counters();
  console.log("before:", before);

  const store = new Map<string, string>([["verdict_visitor", `sim-snippet-${Date.now().toString(36)}`]]);
  const attrs: Record<string, string> = {};
  const sandbox: Record<string, unknown> = {
    console, fetch, setTimeout, clearTimeout, setInterval, clearInterval, XMLHttpRequest: XHRShim,
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, x: string) => store.set(k, x), removeItem: (k: string) => store.delete(k) },
    document: { documentElement: { setAttribute: (k: string, x: string) => (attrs[k] = x) }, addEventListener() {}, visibilityState: "visible" },
    addEventListener() {}, navigator: { userAgent: "verify-snippet" }, location: { href: "http://localhost/" }, crypto: globalThis.crypto,
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  // 1. Load the real SDK exactly as a <script src> would.
  vm.runInContext(readFileSync("node_modules/@flagsmith/flagsmith/index.js", "utf8"), ctx);
  // 2. Run the generated inline script.
  vm.runInContext(script, ctx);
  // init + the flag fetch is a network round trip: poll instead of guessing a delay
  for (let i = 0; i < 40 && !attrs["data-version"]; i++) await new Promise((r) => setTimeout(r, 500));

  console.log("page was told to show version:", attrs["data-version"] ?? "(nothing)");
  if (!attrs["data-version"]) throw new Error("The snippet never set a version, so init or getExperimentFlag failed.");

  // 3. The visitor clicks the goal.
  (sandbox.verdictGoal as () => void)();
  console.log(`visitor "${store.get("verdict_visitor")}" clicked the goal; waiting for Flagsmith to count events...`);

  for (let i = 1; i <= 12; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const now = await counters();
    console.log(`[${i}] total events ${now.total} (was ${before.total}), last at ${now.last}`);
    if (now.total >= before.total + 2) {
      console.log("\nPASS: Flagsmith received the exposure and the click from the generated snippet.");
      return;
    }
  }
  throw new Error("FAIL: the event counter did not rise by 2 within 2 minutes.");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

