import { describe, expect, it, vi } from "vitest";
import { FlagsmithHttpError } from "../flagsmith/client";
import { referee } from "../referee";
import { REPLAY_SCENARIOS } from "../replay";
import {
  decide,
  newSession,
  sendUserMessage,
  type AgentDeps,
} from "./loop";
import { confirmPhrase, gateComplete, riskOf } from "./policy";
import { makeExecutor, ToolInputError, type ToolDeps } from "./tools";
import type { ModelTurn } from "./types";

// ---------- policy ----------

describe("policy", () => {
  it("classifies tools by risk and treats unknown tools as unknown", () => {
    expect(riskOf("get_experiment_verdict")).toBe("read");
    expect(riskOf("create_experiment")).toBe("write");
    expect(riskOf("complete_experiment")).toBe("irreversible");
    expect(riskOf("delete_everything")).toBeUndefined();
  });

  it("only irreversible actions need a typed phrase", () => {
    expect(confirmPhrase("complete_experiment", { experiment_id: 406 })).toBe("COMPLETE 406");
    expect(confirmPhrase("start_experiment", { experiment_id: 406 })).toBeUndefined();
  });

  const shipDecision = referee(REPLAY_SCENARIOS.B); // SHIP, winner Variant_1
  const keepRunning = referee(REPLAY_SCENARIOS.A);
  const invalid = referee(REPLAY_SCENARIOS.C);

  it("allows a variant rollout only for the SHIP winner", () => {
    expect(gateComplete("variant", "Variant_1", shipDecision).allowed).toBe(true);
    expect(gateComplete("variant", "other_variant", shipDecision).allowed).toBe(false);
  });

  it("refuses a variant rollout on KEEP_RUNNING and INVALID verdicts", () => {
    expect(gateComplete("variant", "Variant_1", keepRunning).allowed).toBe(false);
    expect(gateComplete("variant", "one_page", invalid).allowed).toBe(false);
    expect(gateComplete("variant", "x", undefined).allowed).toBe(false);
  });

  it("checks the verdict on its own, even if a winner name matches", () => {
    for (const verdict of ["INVALID", "KEEP_RUNNING", "INCONCLUSIVE"] as const) {
      const forged = { ...shipDecision, verdict, winner: "Variant_1" };
      const g = gateComplete("variant", "Variant_1", forged);
      expect(g.allowed, verdict).toBe(false);
      expect(g.reason).toMatch(new RegExp(verdict));
    }
  });

  it("always allows the safe direction (control / disable)", () => {
    expect(gateComplete("control", undefined, keepRunning).allowed).toBe(true);
    expect(gateComplete("disable", undefined, invalid).allowed).toBe(true);
  });
});

// ---------- tool executors (fake Flagsmith) ----------

function fakeFlagsmith(decisionFrom: keyof typeof REPLAY_SCENARIOS) {
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  const deps: ToolDeps = {
    request: (async (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, ...opts });
      if (path.endsWith("/experiments/406/")) {
        return {
          feature: { multivariate_options: [{ id: 36425, key: "Variant_1", string_value: "x" }] },
        };
      }
      return {};
    }) as ToolDeps["request"],
    loadDecision: async () => ({
      decision: referee(REPLAY_SCENARIOS[decisionFrom]),
      snapshot: REPLAY_SCENARIOS[decisionFrom],
    }),
  };
  return { calls, execute: makeExecutor(deps) };
}

process.env.FLAGSMITH_ENVIRONMENT_KEY ??= "test-env-key";
process.env.FLAGSMITH_API_KEY ??= "test-api-key";
process.env.FLAGSMITH_PROJECT_ID ??= "1";

describe("complete_experiment executor", () => {
  const input = { experiment_id: 406, rollout_decision: "variant", variant_option_id: 36425 };

  it("REFUSES to roll out a variant when the Referee verdict is not SHIP, and never calls /complete/", async () => {
    const { calls, execute } = fakeFlagsmith("A");
    const out = (await execute("complete_experiment", input)) as { refused?: boolean; referee_verdict?: string };
    expect(out.refused).toBe(true);
    expect(out.referee_verdict).toBe("KEEP_RUNNING");
    expect(calls.some((c) => c.path.endsWith("/complete/"))).toBe(false);
  });

  it("completes with the variant when the Referee says SHIP for that variant", async () => {
    const { calls, execute } = fakeFlagsmith("B");
    const out = (await execute("complete_experiment", input)) as { completed?: boolean };
    expect(out.completed).toBe(true);
    const post = calls.find((c) => c.path.endsWith("/complete/"));
    expect(post?.method).toBe("POST");
    expect(post?.body).toEqual({ rollout_decision: "variant", rollout_variant: 36425 });
  });

  it("allows rolling back to control without needing any results", async () => {
    const { calls, execute } = fakeFlagsmith("C");
    await execute("complete_experiment", { experiment_id: 406, rollout_decision: "control", variant_option_id: 0 });
    expect(calls.find((c) => c.path.endsWith("/complete/"))?.body).toEqual({ rollout_decision: "control" });
  });
});

describe("tool input validation", () => {
  it("rejects bad arguments and unknown tools", async () => {
    const { execute } = fakeFlagsmith("A");
    await expect(execute("start_experiment", { experiment_id: "406" })).rejects.toBeInstanceOf(ToolInputError);
    await expect(execute("nope", {})).rejects.toBeInstanceOf(ToolInputError);
    await expect(
      execute("create_experiment", {
        feature_id: 1, name: "n", hypothesis: "h", metric_id: 2, rollout_percentage: 100,
        variant_allocations: [{ option_id: 1, percentage: 100 }],
      }),
    ).rejects.toThrow(/remainder for control/);
  });
});

// ---------- fallbacks for the two spec-vs-docs conflicts ----------

describe("live-write fallbacks", () => {
  type Call = { path: string; method?: string; body?: unknown };
  const bad = (path: string) => new FlagsmithHttpError(400, "POST", path, "bad request");

  function scripted(handler: (path: string, opts?: { method?: string; body?: unknown }) => unknown) {
    const calls: Call[] = [];
    const deps: ToolDeps = {
      request: (async (path: string, opts?: { method?: string; body?: unknown }) => {
        calls.push({ path, ...opts });
        return handler(path, opts);
      }) as ToolDeps["request"],
      loadDecision: async () => {
        throw new Error("unused");
      },
    };
    return { calls, execute: makeExecutor(deps) };
  }

  const exp = {
    feature_id: 1, name: "n", hypothesis: "h", metric_id: 7, rollout_percentage: 100,
    variant_allocations: [{ option_id: 1, percentage: 50 }],
  };
  const createdOk = { id: 99, status: "created" };
  const metricsIn = (c: Call) => (c.body as { metrics?: { metric: unknown }[] })?.metrics?.[0]?.metric;

  it("uses the documented inline integer metric when Flagsmith accepts it", async () => {
    const { calls, execute } = scripted(() => createdOk);
    await execute("create_experiment", exp);
    expect(calls).toHaveLength(1);
    expect(metricsIn(calls[0])).toBe(7);
  });

  it("retries with the spec's string metric when the integer is rejected", async () => {
    const { calls, execute } = scripted((path, opts) => {
      if (metricsIn({ path, ...opts }) === 7) throw bad(path);
      return createdOk;
    });
    await execute("create_experiment", exp);
    expect(calls.map(metricsIn)).toEqual([7, "7"]);
  });

  it("creates without metrics and attaches the metric separately if inline is rejected twice", async () => {
    const { calls, execute } = scripted((path, opts) => {
      if (opts?.body && "metrics" in (opts.body as object)) throw bad(path);
      return createdOk;
    });
    const out = (await execute("create_experiment", exp)) as { experiment_id: number };
    expect(out.experiment_id).toBe(99);
    const last = calls.at(-1)!;
    expect(last.path).toMatch(/experiments\/99\/metrics\/$/);
    expect(last.body).toEqual({ metric: 7, expected_direction: "increase" });
  });

  it("does not retry on a non-400 error", async () => {
    const { calls, execute } = scripted((path) => {
      throw new FlagsmithHttpError(500, "POST", path, "boom");
    });
    await expect(execute("create_experiment", exp)).rejects.toThrow(/HTTP 500/);
    expect(calls).toHaveLength(1);
  });

  it("start: sends no body first, then retries with name + hypothesis on a 400", async () => {
    const { calls, execute } = scripted((path, opts) => {
      if (path.endsWith("/start/") && !opts?.body) throw bad(path);
      if (path.endsWith("/experiments/406/")) return { name: "N", hypothesis: "H" };
      return { status: "running" };
    });
    const out = (await execute("start_experiment", { experiment_id: 406 })) as { status: string };
    expect(out.status).toBe("running");
    const starts = calls.filter((c) => c.path.endsWith("/start/"));
    expect(starts[0].body).toBeUndefined();
    expect(starts[1].body).toEqual({ name: "N", hypothesis: "H" });
  });

  it("start: a plain success makes exactly one call", async () => {
    const { calls, execute } = scripted(() => ({ status: "running" }));
    await execute("start_experiment", { experiment_id: 406 });
    expect(calls).toHaveLength(1);
  });
});

describe("create_feature sets variation keys (Flagsmith ignores them on create)", () => {
  it("PUTs each option with its key (PATCH 500s on Flagsmith) and reports the stored keys", async () => {
    const calls: { path: string; method?: string; body?: unknown }[] = [];
    const execute = makeExecutor({
      loadDecision: async () => { throw new Error("unused"); },
      request: (async (path: string, opts?: { method?: string; body?: unknown }) => {
        calls.push({ path, ...opts });
        if (opts?.method === "PUT") return { key: (opts.body as { key: string }).key };
        return {
          id: 5, name: "f",
          multivariate_options: [
            { id: 11, key: null, string_value: "variant_a" },
            { id: 12, key: null, string_value: "variant_b" },
          ],
        };
      }) as ToolDeps["request"],
    });
    const out = (await execute("create_feature", {
      name: "f",
      variants: [{ key: "Variant_1", value: "variant_a" }, { key: "Variant_2", value: "variant_b" }],
    })) as { options: { option_id: number; key: string }[]; warning?: string };

    const puts = calls.filter((c) => c.method === "PUT");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(puts.map((c) => c.path)).toEqual([
      "projects/1/features/5/mv-options/11/",
      "projects/1/features/5/mv-options/12/",
    ]);
    expect(puts.map((c) => c.body)).toEqual([
      { type: "unicode", string_value: "variant_a", default_percentage_allocation: 0, key: "Variant_1", feature: 5 },
      { type: "unicode", string_value: "variant_b", default_percentage_allocation: 0, key: "Variant_2", feature: 5 },
    ]);
    expect(out.options.map((o) => o.key)).toEqual(["Variant_1", "Variant_2"]);
    expect(out.warning).toBeUndefined();
  });

  it("warns loudly if a key still is not stored", async () => {
    const execute = makeExecutor({
      loadDecision: async () => { throw new Error("unused"); },
      request: (async (_p: string, opts?: { method?: string }) =>
        opts?.method === "PUT"
          ? { key: null }
          : { id: 5, name: "f", multivariate_options: [{ id: 11, key: null, string_value: "variant_a" }] }) as ToolDeps["request"],
    });
    const out = (await execute("create_feature", {
      name: "f", variants: [{ key: "Variant_1", value: "variant_a" }],
    })) as { warning?: string };
    expect(out.warning).toMatch(/no key/);
  });
});

// ---------- the loop (fake model) ----------

const text = (t: string): ModelTurn => ({
  stop: "end",
  message: { role: "assistant", parts: [{ type: "text", text: t }] },
});
// `raw` stands in for provider-native content (Claude thinking blocks or Gemini thought signatures).
const toolUse = (...calls: [string, string, unknown][]): ModelTurn => ({
  stop: "tool_use",
  message: {
    role: "assistant",
    parts: calls.map(([id, name, input]) => ({ type: "tool_call" as const, id, name, input })),
    raw: { opaque: "thinking-or-signature", ids: calls.map((c) => c[0]) },
  },
});

function harness(script: ModelTurn[]) {
  const seen: unknown[][] = [];
  const execute = vi.fn(async (name: string) => ({ ok: true, name }));
  let i = 0;
  const deps: AgentDeps = {
    callModel: async (messages) => {
      seen.push(structuredClone(messages));
      return script[i++];
    },
    execute,
  };
  return { deps, execute, seen, session: newSession("s1") };
}

describe("agent loop autonomy", () => {
  it("runs read tools on its own and finishes", async () => {
    const h = harness([toolUse(["t1", "get_experiment_verdict", { experiment_id: 406 }]), text("Keep running.")]);
    const r = await sendUserMessage(h.session, "how is 406?", h.deps);
    expect(r.status).toBe("done");
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.session.pending).toHaveLength(0);
  });

  it("PAUSES for a write tool and does not execute it until approved", async () => {
    const h = harness([toolUse(["t1", "start_experiment", { experiment_id: 406 }]), text("Started.")]);
    const r = await sendUserMessage(h.session, "start it", h.deps);
    expect(r.status).toBe("awaiting_approval");
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.pending[0]).toMatchObject({ name: "start_experiment", risk: "write" });

    const r2 = await decide(h.session, "t1", "approve", undefined, h.deps);
    expect(r2.status).toBe("done");
    expect(h.execute).toHaveBeenCalledWith("start_experiment", { experiment_id: 406 });
  });

  it("a denied action is never executed and the model is told", async () => {
    const h = harness([toolUse(["t1", "start_experiment", { experiment_id: 406 }]), text("Understood.")]);
    await sendUserMessage(h.session, "start it", h.deps);
    await decide(h.session, "t1", "deny", undefined, h.deps);
    expect(h.execute).not.toHaveBeenCalled();
    const lastUser = h.seen[1].at(-1) as { parts: { isError: boolean; payload: { denied: boolean } }[] };
    expect(lastUser.parts[0].isError).toBe(true);
    expect(lastUser.parts[0].payload.denied).toBe(true);
  });

  it("an irreversible action needs the exact typed phrase, checked on the server", async () => {
    const input = { experiment_id: 406, rollout_decision: "control", variant_option_id: 0 };
    const h = harness([toolUse(["t1", "complete_experiment", input]), text("Done.")]);
    await sendUserMessage(h.session, "wrap up", h.deps);
    expect(h.session.pending[0].confirmPhrase).toBe("COMPLETE 406");

    const wrong = await decide(h.session, "t1", "approve", "yes", h.deps);
    expect(wrong.status).toBe("awaiting_approval");
    expect(wrong.message).toMatch(/COMPLETE 406/);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.pending).toHaveLength(1);

    const right = await decide(h.session, "t1", "approve", "COMPLETE 406", h.deps);
    expect(right.status).toBe("done");
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it("answers parallel read + write calls in ONE user message, in call order", async () => {
    const h = harness([
      toolUse(
        ["a", "get_experiment_verdict", { experiment_id: 406 }],
        ["b", "start_experiment", { experiment_id: 406 }],
      ),
      text("ok"),
    ]);
    await sendUserMessage(h.session, "go", h.deps);
    expect(h.execute).toHaveBeenCalledTimes(1); // read ran, write did not
    await decide(h.session, "b", "approve", undefined, h.deps);
    const lastUser = h.seen[1].at(-1) as { role: string; parts: { id: string }[] };
    expect(lastUser.role).toBe("user");
    expect(lastUser.parts.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("answers an unknown tool with an error instead of executing it", async () => {
    const h = harness([toolUse(["t1", "drop_database", {}]), text("Sorry.")]);
    const r = await sendUserMessage(h.session, "x", h.deps);
    expect(r.status).toBe("done");
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("blocks new user messages while an approval is pending", async () => {
    const h = harness([toolUse(["t1", "start_experiment", { experiment_id: 406 }])]);
    await sendUserMessage(h.session, "start", h.deps);
    const r = await sendUserMessage(h.session, "also this", h.deps);
    expect(r.status).toBe("awaiting_approval");
  });

  it("keeps the provider's raw assistant content (thinking / signatures) unchanged for replay", async () => {
    const first = toolUse(["t1", "get_experiment_verdict", { experiment_id: 406 }]);
    const h = harness([first, text("done")]);
    await sendUserMessage(h.session, "x", h.deps);
    expect(h.session.messages[1].raw).toEqual(first.message.raw);
    // ...and the second model call really received it.
    expect((h.seen[1][1] as { raw: unknown }).raw).toEqual(first.message.raw);
  });

  it("reports a refusal stop reason instead of continuing", async () => {
    const h = harness([{ stop: "refusal", message: { role: "assistant", parts: [] } }]);
    const r = await sendUserMessage(h.session, "x", h.deps);
    expect(r.status).toBe("error");
  });
});
