// Tool definitions the model sees, and the executors that run them against the
// Flagsmith Admin API. Endpoints and bodies were verified against Flagsmith's
// published OpenAPI spec (api.flagsmith.com/api/v1/swagger.json).

import type Anthropic from "@anthropic-ai/sdk";
import { NoResultsYetError, toSnapshot } from "../flagsmith/adapter";
import type { FlagsmithExperimentDetail, FlagsmithResults } from "../flagsmith/adapter";
import {
  envPath,
  FlagsmithHttpError,
  flagsmithRequest,
  projectPath,
  type HttpMethod,
} from "../flagsmith/client";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { connectionFromEnv, DEFAULT_CLEANUP_PATH, type Connection } from "../connection";
import { readEventCounter } from "../flagsmith/integration";
import { githubFor, type GitHubApi } from "../github/client";
import { htmlSnippet, reactSnippets, validateSnippetInput } from "../snippets";
import { referee } from "../referee";
import type { Decision, ExperimentSnapshot } from "../types";
import {
  applyCleanup,
  CleanupError,
  findReferences,
  isAllowedCleanupPath,
  keptBranchFor,
  prBody,
  unifiedDiff,
} from "./cleanup";
import { gateComplete, isToolName } from "./policy";

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_experiments",
    description:
      "List the experiments in the connected Flagsmith environment (id, name, status). Read-only.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_experiment_verdict",
    description:
      "Fetch an experiment's current results from Flagsmith and run the deterministic Referee on them. Returns the verdict (SHIP, KEEP_RUNNING, INCONCLUSIVE or INVALID), the pass/fail checklist and the uncertainties. This is the ONLY source of truth for whether a result can be trusted. Read-only.",
    input_schema: {
      type: "object",
      properties: { experiment_id: { type: "integer" } },
      required: ["experiment_id"],
      additionalProperties: false,
    },
  },
  {
    name: "refresh_results",
    description:
      "Ask Flagsmith to recompute an experiment's results (rate limited to once per 5 minutes). Does not change the experiment.",
    input_schema: {
      type: "object",
      properties: { experiment_id: { type: "integer" } },
      required: ["experiment_id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_feature",
    description:
      "Create a multivariate feature flag. The control (the person's CURRENT version) is created automatically with the value \"control\", so list ONLY the NEW versions as variants, never the current one. Each variant needs a short key (e.g. \"Variant_1\") and a value. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "snake_case flag name" },
        variants: {
          type: "array",
          items: {
            type: "object",
            properties: { key: { type: "string" }, value: { type: "string" } },
            required: ["key", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["name", "variants"],
      additionalProperties: false,
    },
  },
  {
    name: "create_metric",
    description:
      "Create an occurrence metric (did the identity trigger the event at least once; higher is better). event_name is case-sensitive and must match what the app sends. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        event_name: { type: "string" },
      },
      required: ["name", "description", "event_name"],
      additionalProperties: false,
    },
  },
  {
    name: "create_experiment",
    description:
      "Create (but do not start) an experiment on a multivariate flag. variant_allocations lists each variation option id with the percent of ENROLLED traffic it receives; control gets the remainder. It must include EVERY variation of the flag (Flagsmith rejects the experiment otherwise). Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        feature_id: { type: "integer" },
        name: { type: "string" },
        hypothesis: {
          type: "string",
          description: "Names the change, the metric, the expected size and the timeframe.",
        },
        metric_id: { type: "integer" },
        rollout_percentage: { type: "integer", description: "1-100, share of all identities enrolled" },
        variant_allocations: {
          type: "array",
          items: {
            type: "object",
            properties: { option_id: { type: "integer" }, percentage: { type: "integer" } },
            required: ["option_id", "percentage"],
            additionalProperties: false,
          },
        },
      },
      required: ["feature_id", "name", "hypothesis", "metric_id", "rollout_percentage", "variant_allocations"],
      additionalProperties: false,
    },
  },
  {
    name: "start_experiment",
    description:
      "Start a created experiment. The flag and its variations lock while it runs. Requires human approval.",
    input_schema: {
      type: "object",
      properties: { experiment_id: { type: "integer" } },
      required: ["experiment_id"],
      additionalProperties: false,
    },
  },
  {
    name: "pause_experiment",
    description: "Pause a running experiment. Requires human approval.",
    input_schema: {
      type: "object",
      properties: { experiment_id: { type: "integer" } },
      required: ["experiment_id"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_experiment",
    description:
      "Permanently end an experiment and set what the flag serves afterwards: control, one variant, or disabled. IRREVERSIBLE. Choosing \"variant\" is refused by code unless the Referee verdict is SHIP for exactly that variant. Requires human approval with a typed confirmation.",
    input_schema: {
      type: "object",
      properties: {
        experiment_id: { type: "integer" },
        rollout_decision: { type: "string", enum: ["control", "variant", "disable"] },
        variant_option_id: {
          type: "integer",
          description: "Required when rollout_decision is \"variant\": the variation option id to roll out. Use 0 otherwise.",
        },
      },
      required: ["experiment_id", "rollout_decision", "variant_option_id"],
      additionalProperties: false,
    },
  },
  {
    name: "find_flag_references",
    description:
      "Search the demo app (app/demo/) for code that reads a feature flag, so you know which file to clean up. Read-only.",
    input_schema: {
      type: "object",
      properties: { flag_name: { type: "string" } },
      required: ["flag_name"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_integration_snippet",
    description:
      "Generate the exact code a person pastes into THEIR website so Flagsmith splits their visitors between the versions and counts the goal. Uses the connected project's client-side environment key (public by design). Call it only after the flag, metric and experiment exist. Read-only: it does not change anything and cannot edit the person's files. site_type is \"html\" for any plain website, or \"react\" for React/Next.js (the only kind the later cleanup pull request can remove). For react, pass `labels` with the real wording, e.g. {\"control\": \"Get started free\", \"start_it\": \"Start it\"}.",
    input_schema: {
      type: "object",
      properties: {
        site_type: { type: "string", enum: ["html", "react"] },
        flag: { type: "string", description: "The flag name used in create_feature." },
        event: { type: "string", description: "The goal event name used in create_metric." },
        versions: { type: "array", items: { type: "string" }, description: "Variant values from create_feature. NOT control." },
        labels: { type: "object", additionalProperties: { type: "string" }, description: "Optional wording per version, including \"control\"." },
      },
      required: ["site_type", "flag", "event", "versions"],
      additionalProperties: false,
    },
  },
  {
    name: "check_integration",
    description:
      "Check whether Flagsmith is receiving events from the person's website (the event counter only rises when a real browser reports in). Read-only. Call it after they say they pasted the code and opened their site.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "open_cleanup_pr",
    description:
      "After an experiment has been COMPLETED, open a pull request that removes the losing code path in one file under app/demo/ (or return the diff if GitHub is not configured). The branch to keep is taken from the experiment's recorded rollout decision, not from you. Refused if the experiment is not completed. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        experiment_id: { type: "integer" },
        file_path: { type: "string", description: "Repo-relative path under app/demo/, e.g. app/demo/checkout-button.tsx" },
      },
      required: ["experiment_id", "file_path"],
      additionalProperties: false,
    },
  },
];

// ---- input validation (the model's arguments are untrusted) ----

type Obj = Record<string, unknown>;

function obj(input: unknown): Obj {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ToolInputError("Tool input must be an object.");
  }
  return input as Obj;
}
function int(o: Obj, k: string): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isInteger(v)) throw new ToolInputError(`"${k}" must be an integer.`);
  return v;
}
function str(o: Obj, k: string): string {
  const v = o[k];
  if (typeof v !== "string" || v.trim() === "") throw new ToolInputError(`"${k}" must be a non-empty string.`);
  return v;
}

export class ToolInputError extends Error {}

// ---- executors ----

export interface ToolDeps {
  request: <T>(path: string, opts?: { method?: HttpMethod; body?: unknown }) => Promise<T>;
  /** Loads the experiment's current Referee decision and snapshot. */
  loadDecision: (experimentId: number) => Promise<{ decision: Decision; snapshot: ExperimentSnapshot }>;
  /** Local files (the working tree). Optional so Flagsmith-only tests need no fakes. */
  files?: {
    read: (repoRelativePath: string) => Promise<string>;
    listDemo: () => Promise<{ path: string; content: string }[]>;
  };
  /** GitHub access, or null when no repo and token are connected. */
  github?: () => GitHubApi | null;
  /** Whose Flagsmith project and repo to act on. Defaults to .env.local. */
  conn?: Connection;
}

const connOf = (deps: ToolDeps) => deps.conn ?? connectionFromEnv();
const ep = (deps: ToolDeps, sub: string) => envPath(sub, connOf(deps));
const pp = (deps: ToolDeps, sub: string) => projectPath(sub, connOf(deps));

async function listLocalFiles(dir: string): Promise<{ path: string; content: string }[]> {
  const out: { path: string; content: string }[] = [];
  for (const e of await readdir(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await listLocalFiles(rel)));
    else if (isAllowedCleanupPath(rel)) out.push({ path: rel, content: await readFile(join(process.cwd(), rel), "utf8") });
  }
  return out;
}

/** Real dependencies for one connection: its Flagsmith project, its GitHub repo. */
export function depsFor(conn: Connection): ToolDeps {
  return {
    conn,
    request: (path, opts) => flagsmithRequest(path, opts, conn),
    files: {
      // Local files are only this demo repo; a connected repo is read via GitHub.
      read: (p) => readFile(join(process.cwd(), p), "utf8"),
      listDemo: () => listLocalFiles(DEFAULT_CLEANUP_PATH.replace(/\/$/, "")),
    },
    github: () => githubFor(conn),
    async loadDecision(id) {
      const [detail, results] = await Promise.all([
        flagsmithRequest<FlagsmithExperimentDetail>(envPath(`experiments/${id}/`, conn), {}, conn),
        flagsmithRequest<FlagsmithResults>(envPath(`experiments/${id}/results/`, conn), {}, conn),
      ]);
      const snapshot = toSnapshot(detail, results, { synthetic: !conn.trafficIsReal });
      return { decision: referee(snapshot), snapshot };
    },
  };
}

const isBadRequest = (e: unknown) => e instanceof FlagsmithHttpError && e.status === 400;

/**
 * Flagsmith's OpenAPI spec and its agent documentation disagree about two
 * details, and neither was exercised live when this was written. So each call
 * tries the documented form first and falls back to the spec's form on a 400.
 */
async function createExperimentWithMetric(
  deps: ToolDeps,
  base: Obj,
  metricId: number,
): Promise<{ id: number; status: string }> {
  const direction = "increase";
  // 1. Documented form: integer metric id inline.
  // 2. Spec form: ExperimentMetricInline types `metric` as a string.
  for (const metric of [metricId, String(metricId)]) {
    try {
      return await deps.request<{ id: number; status: string }>(ep(deps, "experiments/"), {
        method: "POST",
        body: { ...base, metrics: [{ metric, expected_direction: direction }] },
      });
    } catch (e) {
      if (!isBadRequest(e)) throw e;
    }
  }
  // 3. Create without metrics, then attach through the dedicated endpoint.
  const created = await deps.request<{ id: number; status: string }>(ep(deps, "experiments/"), {
    method: "POST",
    body: base,
  });
  await deps.request(ep(deps, `experiments/${created.id}/metrics/`), {
    method: "POST",
    body: { metric: metricId, expected_direction: direction },
  });
  return created;
}

/** start/pause: the docs say no body, the spec marks a body as required. */
async function lifecycleCall(
  deps: ToolDeps,
  id: number,
  action: "start" | "pause",
): Promise<{ status?: string }> {
  const path = ep(deps, `experiments/${id}/${action}/`);
  try {
    return await deps.request<{ status?: string }>(path, { method: "POST" });
  } catch (e) {
    if (!isBadRequest(e)) throw e;
    const d = await deps.request<FlagsmithExperimentDetail>(ep(deps, `experiments/${id}/`));
    return await deps.request<{ status?: string }>(path, {
      method: "POST",
      body: { name: d.name, hypothesis: d.hypothesis },
    });
  }
}

interface FeatureResponse {
  id: number;
  name: string;
  multivariate_options?: { id: number; key: string | null; string_value: string | null }[];
}

export function makeExecutor(deps: ToolDeps) {
  return async function execute(name: string, rawInput: unknown): Promise<unknown> {
    if (!isToolName(name)) throw new ToolInputError(`Unknown tool "${name}".`);

    switch (name) {
      case "list_experiments": {
        const r = await deps.request<unknown>(ep(deps, "experiments/"));
        const items = Array.isArray(r) ? r : ((r as Obj)?.results as unknown[]) ?? [];
        return (items as Obj[]).map((e) => ({ id: e.id, name: e.name, status: e.status }));
      }

      case "get_experiment_verdict": {
        const id = int(obj(rawInput), "experiment_id");
        try {
          const { decision, snapshot } = await deps.loadDecision(id);
          return {
            experiment: snapshot.name,
            source: snapshot.source,
            simulated_traffic: snapshot.synthetic,
            arms: snapshot.arms.map((a) => ({
              name: a.name,
              exposures: a.exposures,
              conversions: a.conversions,
              chance_to_beat_control: a.winProbability ?? null,
            })),
            decision,
          };
        } catch (e) {
          if (e instanceof NoResultsYetError) {
            return { status: "no_results_yet", message: e.message };
          }
          throw e;
        }
      }

      case "refresh_results": {
        const id = int(obj(rawInput), "experiment_id");
        await deps.request(ep(deps, `experiments/${id}/results/refresh/`), { method: "POST" });
        return { status: "refresh_requested", note: "Results update within a few seconds; call get_experiment_verdict." };
      }

      case "generate_integration_snippet": {
        const o = obj(rawInput);
        const siteType = str(o, "site_type");
        if (siteType !== "html" && siteType !== "react") throw new ToolInputError('"site_type" must be "html" or "react".');
        const conn = connOf(deps);
        if (!conn.environmentKey) {
          throw new ToolInputError("No Flagsmith environment key is connected. Ask the person to open Connect and add their project.");
        }
        const versions = o.versions;
        if (!Array.isArray(versions) || versions.some((v) => typeof v !== "string")) {
          throw new ToolInputError('"versions" must be an array of strings.');
        }
        let labels: Record<string, string> | undefined;
        if (o.labels !== undefined) {
          const l = obj(o.labels);
          labels = {};
          for (const [k, v] of Object.entries(l)) {
            if (typeof v !== "string") throw new ToolInputError(`The wording for "${k}" must be a string.`);
            labels[k] = v;
          }
        }
        const parsed = validateSnippetInput({
          environmentKey: conn.environmentKey,
          flag: str(o, "flag"),
          event: str(o, "event"),
          versions: versions as string[],
          labels,
        });
        if (!parsed.ok) throw new ToolInputError(parsed.error);
        if (siteType === "html") {
          return {
            site_type: "html",
            note: "Paste this into the page you are testing, just before </body>, then fill in the CSS for each version and call verdictGoal() on the goal button.",
            code: htmlSnippet(parsed.value),
          };
        }
        const r = reactSnippets(parsed.value);
        return {
          site_type: "react",
          note: "Four steps: install the SDK, add the provider around the app (for example in app/layout.tsx), add lib/experiment.ts, then use the button component where the element lives. Add the env line to .env.local AND to the host's environment variables, then restart the dev server.",
          env_line: r.envLine,
          install: r.install,
          provider: r.provider,
          helper: r.helper,
          usage: r.usage,
        };
      }

      case "check_integration": {
        const s = await readEventCounter(connOf(deps), (p) => deps.request(p));
        if (!s.connected) return { status: "not_connected", message: "No Flagsmith project is connected. Open Connect first." };
        if (s.error) return { status: "error", message: s.error };
        if (!s.enabled) {
          return { status: "no_warehouse", message: "No event warehouse is enabled. In Flagsmith: Environment Settings, then Warehouse." };
        }
        return {
          status: s.total > 0 ? "receiving_events" : "no_events_yet",
          total_events: s.total,
          last_event_at: s.last,
          note: "The counter can lag by a minute or two. It does not say whether an event was an exposure or a click.",
        };
      }

      case "create_feature": {
        const o = obj(rawInput);
        const variants = o.variants;
        if (!Array.isArray(variants) || variants.length < 1) {
          throw new ToolInputError('"variants" must be a non-empty array.');
        }
        // The control is created automatically; listing it again would split traffic
        // between two identical groups.
        const dup = variants.find((v) => {
          const vo = obj(v);
          return [vo.key, vo.value].some((x) => typeof x === "string" && x.trim().toLowerCase() === "control");
        });
        if (dup) {
          throw new ToolInputError('"control" is created automatically for the current version. List only the NEW versions as variants.');
        }
        const created = await deps.request<FeatureResponse>(pp(deps, "features/"), {
          method: "POST",
          body: {
            name: str(o, "name"),
            type: "MULTIVARIATE",
            default_enabled: true,
            initial_value: "control",
            multivariate_options: variants.map((v) => {
              const vo = obj(v);
              return {
                type: "unicode",
                string_value: str(vo, "value"),
                default_percentage_allocation: 0,
                key: str(vo, "key"),
              };
            }),
          },
        });
        // Verified live: Flagsmith ignores `key` on nested create (it comes back
        // null), and a variation without a key records NO exposures. So set each
        // key explicitly, matching by value, and report what is really stored.
        const wanted = new Map(
          variants.map((v) => [str(obj(v), "value"), str(obj(v), "key")] as const),
        );
        const options = [];
        for (const m of created.multivariate_options ?? []) {
          let key = m.key;
          const want = m.string_value ? wanted.get(m.string_value) : undefined;
          if (want && key !== want) {
            // Verified live: PATCH on mv-options returns HTTP 500; a full PUT works.
            const updated = await deps.request<{ key: string | null }>(
              pp(deps, `features/${created.id}/mv-options/${m.id}/`),
              {
                method: "PUT",
                body: {
                  type: "unicode",
                  string_value: m.string_value,
                  default_percentage_allocation: 0,
                  key: want,
                  feature: created.id,
                },
              },
            );
            key = updated.key;
          }
          options.push({ option_id: m.id, key, value: m.string_value });
        }
        const missing = options.filter((o) => !o.key);
        return {
          feature_id: created.id,
          name: created.name,
          options,
          ...(missing.length
            ? { warning: `Variations ${missing.map((o) => o.option_id).join(", ")} have no key, so they will record no exposures.` }
            : {}),
        };
      }

      case "create_metric": {
        const o = obj(rawInput);
        const created = await deps.request<{ id: number; name: string }>(ep(deps, "experiment-metrics/"), {
          method: "POST",
          body: {
            name: str(o, "name"),
            description: str(o, "description"),
            aggregation: "occurrence",
            direction: "up",
            definition: { version: 1, event: str(o, "event_name") },
          },
        });
        return { metric_id: created.id, name: created.name };
      }

      case "create_experiment": {
        const o = obj(rawInput);
        const rollout = int(o, "rollout_percentage");
        if (rollout < 1 || rollout > 100) throw new ToolInputError('"rollout_percentage" must be 1-100.');
        const allocs = o.variant_allocations;
        if (!Array.isArray(allocs) || allocs.length < 1) {
          throw new ToolInputError('"variant_allocations" must be a non-empty array.');
        }
        const parsed = allocs.map((a) => ({
          multivariate_feature_option: int(obj(a), "option_id"),
          percentage_allocation: int(obj(a), "percentage"),
        }));
        const total = parsed.reduce((s, a) => s + a.percentage_allocation, 0);
        if (parsed.some((a) => a.percentage_allocation < 1) || total >= 100) {
          throw new ToolInputError("Each variant needs at least 1% and the total must leave a remainder for control (under 100).");
        }
        const created = await createExperimentWithMetric(
          deps,
          {
            feature: int(o, "feature_id"),
            name: str(o, "name"),
            hypothesis: str(o, "hypothesis"),
            experiment_rollout: {
              enabled: true,
              rollout_percentage: rollout,
              feature_state_value: { type: "string", value: "control" },
              multivariate_feature_state_values: parsed,
            },
          },
          int(o, "metric_id"),
        );
        return { experiment_id: created.id, status: created.status };
      }

      case "start_experiment": {
        const id = int(obj(rawInput), "experiment_id");
        const r = await lifecycleCall(deps, id, "start");
        return { experiment_id: id, status: r.status ?? "started" };
      }

      case "pause_experiment": {
        const id = int(obj(rawInput), "experiment_id");
        const r = await lifecycleCall(deps, id, "pause");
        return { experiment_id: id, status: r.status ?? "paused" };
      }

      case "complete_experiment": {
        const o = obj(rawInput);
        const id = int(o, "experiment_id");
        const decisionKind = str(o, "rollout_decision");
        const optionId = int(o, "variant_option_id");

        // Defence in depth: the gate runs here too, not only in the loop, so
        // no caller can reach the irreversible endpoint without a SHIP verdict.
        // Rolling back (control/disable) is the safe direction and needs no
        // results; rolling out a variant needs a fresh SHIP verdict.
        let decision: Decision | undefined;
        let variantKey: string | undefined;
        if (decisionKind === "variant") {
          decision = (await deps.loadDecision(id)).decision;
          const detail = await deps.request<FlagsmithExperimentDetail>(ep(deps, `experiments/${id}/`));
          variantKey = detail.feature.multivariate_options.find((m) => m.id === optionId)?.key;
        }
        const gate = gateComplete(decisionKind, variantKey, decision);
        if (!gate.allowed) return { refused: true, reason: gate.reason, referee_verdict: decision?.verdict ?? null };

        const body: Obj = { rollout_decision: decisionKind };
        if (decisionKind === "variant") body.rollout_variant = optionId;
        await deps.request(ep(deps, `experiments/${id}/complete/`), { method: "POST", body });
        return { completed: true, experiment_id: id, rollout_decision: decisionKind, gate: gate.reason };
      }

      case "find_flag_references": {
        const flag = str(obj(rawInput), "flag_name");
        // A connected repo is searched on GitHub (its cleanup folder only);
        // otherwise this demo repo's app/demo/ folder on disk.
        const gh = deps.github?.() ?? null;
        const prefix = gh ? connOf(deps).cleanupPath : DEFAULT_CLEANUP_PATH;
        let files: { path: string; content: string }[];
        if (gh) {
          const paths = (await gh.listFiles(prefix)).filter((p) => isAllowedCleanupPath(p, prefix)).slice(0, 40);
          files = await Promise.all(paths.map(async (p) => ({ path: p, content: (await gh.getFile(p)).content })));
        } else {
          if (!deps.files) throw new ToolInputError("File access is not available here.");
          files = await deps.files.listDemo();
        }
        const hits = findReferences(files, flag);
        return {
          flag,
          searched: gh ? `${connOf(deps).githubRepo}:${prefix}` : `this repo:${prefix}`,
          references: hits,
          note: hits.length ? undefined : `No pick(useExperiment(...)) call for this flag under ${prefix}.`,
        };
      }

      case "open_cleanup_pr": {
        const o = obj(rawInput);
        const id = int(o, "experiment_id");
        const path = str(o, "file_path");
        // 1. Path allow-list: cleanup only touches the connection's cleanup folder
        //    (app/demo/ when no repo is connected).
        const ghForPath = deps.github?.() ?? null;
        const prefix = ghForPath ? connOf(deps).cleanupPath : DEFAULT_CLEANUP_PATH;
        if (!isAllowedCleanupPath(path, prefix)) {
          return { refused: true, reason: `Refused: cleanup may only touch .ts, .tsx, .js or .jsx files under ${prefix}.` };
        }
        if (!deps.files) throw new ToolInputError("File access is not available here.");

        // 2. The kept branch comes from the experiment's RECORDED decision.
        const detail = await deps.request<FlagsmithExperimentDetail>(ep(deps, `experiments/${id}/`));
        const kept = keptBranchFor(detail);
        if (!kept.ok) return { refused: true, reason: kept.reason };
        const flag = detail.feature.name;
        if (!flag) return { refused: true, reason: "Refused: could not determine the flag name." };

        // 3. Base content: the repo's default branch when GitHub is configured, else the local file.
        const gh = deps.github?.() ?? null;
        let before: string;
        let fileSha = "";
        let defaultBranch = "";
        if (gh) {
          const f = await gh.getFile(path);
          before = f.content;
          fileSha = f.sha;
          defaultBranch = f.defaultBranch;
        } else {
          before = await deps.files.read(path);
        }

        let after: string;
        let literal: string;
        try {
          const r = applyCleanup(before, flag, kept.keepValue);
          after = r.code;
          literal = r.keptLiteral;
        } catch (e) {
          if (e instanceof CleanupError) return { refused: true, reason: `Refused: ${e.message}` };
          throw e;
        }
        const diff = unifiedDiff(path, before, after);

        if (!gh) {
          return {
            mode: "local_diff",
            note: "GitHub is not configured (GITHUB_TOKEN and GITHUB_REPO), so no pull request was opened and no file was changed. This is the exact change that would be proposed.",
            kept_branch: kept.keepValue,
            diff,
          };
        }

        // 4. Referee context for the PR body. Missing results never block the PR.
        let decision: Decision | undefined;
        let snapshot: ExperimentSnapshot | undefined;
        try {
          ({ decision, snapshot } = await deps.loadDecision(id));
        } catch {
          /* body says results could not be loaded */
        }
        const safeFlag = flag.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
        const pr = await gh.openPullRequest({
          branch: `verdict/cleanup-${safeFlag}-${id}`,
          path,
          newContent: after,
          fileSha,
          defaultBranch,
          commitMessage: `Remove experiment code for ${flag} (keep ${kept.keepValue})`,
          title: `Remove ${flag} experiment code, keep ${kept.keepValue}`,
          body: prBody({ flag, experimentId: id, keptValue: kept.keepValue, filePath: path, decision, snapshot }),
        });
        return { mode: "pull_request", url: pr.url, number: pr.number, kept_branch: kept.keepValue, kept_literal: literal, diff };
      }
    }
  };
}

/** For scripts: acts with the .env.local connection. */
export const executeTool = (name: string, input: unknown) => makeExecutor(depsFor(connectionFromEnv()))(name, input);
