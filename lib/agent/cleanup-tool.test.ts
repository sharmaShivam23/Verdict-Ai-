import { describe, expect, it } from "vitest";
import type { GitHubApi } from "../github/client";
import { referee } from "../referee";
import { REPLAY_SCENARIOS } from "../replay";
import { riskOf } from "./policy";
import { connectionFromEnv } from "../connection";
import { makeExecutor, TOOLS, type ToolDeps } from "./tools";

process.env.FLAGSMITH_ENVIRONMENT_KEY ??= "test-env-key";
process.env.FLAGSMITH_API_KEY ??= "test-api-key";
process.env.FLAGSMITH_PROJECT_ID ??= "1";

const SOURCE = `import { useExperiment, useFlagsmith } from "@flagsmith/flagsmith/react";
import { pick } from "@/lib/experiment";
export default function B() {
  const f = useFlagsmith();
  const label = pick(useExperiment("my_flag"), { control: "Checkout", variant_a: "Buy now" });
  return <button onClick={() => f.trackEvent("x")}>{label}</button>;
}
`;

const completed = (over: Record<string, unknown> = {}) => ({
  id: 9,
  status: "completed",
  rollout_decision: "variant",
  rollout_variant: 11,
  feature: { name: "my_flag", multivariate_options: [{ id: 11, key: "Variant_1", string_value: "variant_a" }] },
  ...over,
});

function setup(opts: { detail?: unknown; github?: GitHubApi | null; files?: Record<string, string> } = {}) {
  const writes: unknown[] = [];
  const files = opts.files ?? { "app/demo/b.tsx": SOURCE };
  const deps: ToolDeps = {
    request: (async (path: string, o?: { method?: string }) => {
      if (o?.method && o.method !== "GET") writes.push({ path, ...o });
      return opts.detail ?? completed();
    }) as ToolDeps["request"],
    loadDecision: async () => ({ decision: referee(REPLAY_SCENARIOS.B), snapshot: REPLAY_SCENARIOS.B }),
    files: {
      read: async (p) => {
        if (!(p in files)) throw new Error("ENOENT");
        return files[p];
      },
      listDemo: async () => Object.entries(files).map(([path, content]) => ({ path, content })),
    },
    github: () => opts.github ?? null,
  };
  return { execute: makeExecutor(deps), writes };
}

function fakeGitHub(base = SOURCE, tree: string[] = ["app/demo/b.tsx"]) {
  const calls: Record<string, unknown>[] = [];
  const api: GitHubApi = {
    listFiles: async (prefix) => {
      calls.push({ op: "listFiles", prefix });
      return tree.filter((p) => p.startsWith(prefix));
    },
    getFile: async (path) => {
      calls.push({ op: "getFile", path });
      return { content: base, sha: "abc123", defaultBranch: "main" };
    },
    openPullRequest: async (a) => {
      calls.push({ op: "openPullRequest", ...a });
      return { url: "https://github.com/o/r/pull/7", number: 7 };
    },
  };
  return { api, calls };
}

const input = { experiment_id: 9, file_path: "app/demo/b.tsx" };

describe("cleanup tools are registered with the right risk", () => {
  it("find_flag_references reads; open_cleanup_pr needs approval", () => {
    expect(riskOf("find_flag_references")).toBe("read");
    expect(riskOf("open_cleanup_pr")).toBe("write");
    expect(TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(["find_flag_references", "open_cleanup_pr"]));
  });
});

describe("find_flag_references", () => {
  it("finds the flag under app/demo/", async () => {
    const { execute } = setup();
    const out = (await execute("find_flag_references", { flag_name: "my_flag" })) as { references: { path: string; line: number }[] };
    expect(out.references).toEqual([expect.objectContaining({ path: "app/demo/b.tsx", line: 5 })]);
  });
});

describe("open_cleanup_pr refusals (nothing is written or opened)", () => {
  it("refuses a path outside app/demo/", async () => {
    const gh = fakeGitHub();
    const { execute } = setup({ github: gh.api });
    for (const p of ["lib/referee.ts", "app/demo/../page.tsx", ".env.local", "/etc/passwd"]) {
      const out = (await execute("open_cleanup_pr", { experiment_id: 9, file_path: p })) as { refused?: boolean };
      expect(out.refused, p).toBe(true);
    }
    expect(gh.calls).toHaveLength(0);
  });

  it("refuses while the experiment is still running or has no recorded decision", async () => {
    for (const detail of [completed({ status: "running" }), completed({ rollout_decision: null }), completed({ rollout_decision: "disable" })]) {
      const gh = fakeGitHub();
      const { execute } = setup({ detail, github: gh.api });
      const out = (await execute("open_cleanup_pr", input)) as { refused?: boolean; reason?: string };
      expect(out.refused).toBe(true);
      expect(out.reason).toMatch(/Refused/);
      expect(gh.calls).toHaveLength(0);
    }
  });

  it("refuses a file that does not contain the convention, instead of guessing", async () => {
    const gh = fakeGitHub("export const x = 1;\n");
    const { execute } = setup({ github: gh.api });
    const out = (await execute("open_cleanup_pr", input)) as { refused?: boolean; reason?: string };
    expect(out.refused).toBe(true);
    expect(out.reason).toMatch(/No pick\(useExperiment/);
    expect(gh.calls.filter((c) => c.op === "openPullRequest")).toHaveLength(0);
  });

  it("never reaches the Flagsmith write endpoints", async () => {
    const { execute, writes } = setup({ github: fakeGitHub().api });
    await execute("open_cleanup_pr", input);
    expect(writes).toEqual([]);
  });
});

describe("open_cleanup_pr without GitHub configured", () => {
  it("returns the exact diff and changes nothing", async () => {
    const { execute } = setup({ github: null });
    const out = (await execute("open_cleanup_pr", input)) as { mode: string; diff: string; kept_branch: string; note: string };
    expect(out.mode).toBe("local_diff");
    expect(out.kept_branch).toBe("variant_a");
    expect(out.diff).toContain('+  const label = "Buy now";');
    expect(out.diff).toContain("-  const label = pick(useExperiment");
    expect(out.note).toMatch(/no pull request was opened/);
  });
});

describe("open_cleanup_pr with GitHub configured", () => {
  it("opens a PR from the default branch's file, with the Referee in the body", async () => {
    const gh = fakeGitHub();
    const { execute } = setup({ github: gh.api });
    const out = (await execute("open_cleanup_pr", input)) as { mode: string; url: string; number: number };
    expect(out).toMatchObject({ mode: "pull_request", url: "https://github.com/o/r/pull/7", number: 7 });

    expect(gh.calls.map((c) => c.op)).toEqual(["getFile", "openPullRequest"]);
    const pr = gh.calls[1] as { branch: string; newContent: string; fileSha: string; defaultBranch: string; body: string; title: string };
    expect(pr.branch).toBe("verdict/cleanup-my_flag-9");
    expect(pr.fileSha).toBe("abc123");
    expect(pr.defaultBranch).toBe("main");
    expect(pr.newContent).toContain('const label = "Buy now";');
    expect(pr.newContent).not.toContain("useExperiment");
    expect(pr.title).toMatch(/keep variant_a/);
    expect(pr.body).toMatch(/Verdict: SHIP/);
    expect(pr.body).toMatch(/SIMULATED/);
  });

  it("uses control when control was the decision", async () => {
    const gh = fakeGitHub();
    const { execute } = setup({ detail: completed({ rollout_decision: "control", rollout_variant: null }), github: gh.api });
    await execute("open_cleanup_pr", input);
    expect((gh.calls[1] as { newContent: string }).newContent).toContain('const label = "Checkout";');
  });

  it("lower-cases the flag name in the branch name", async () => {
    const gh = fakeGitHub(SOURCE.replace("my_flag", "My_Flag-2"));
    const { execute } = setup({ detail: completed({ feature: { name: "My_Flag-2", multivariate_options: [{ id: 11, key: "v", string_value: "variant_a" }] } }), github: gh.api });
    await execute("open_cleanup_pr", input);
    expect((gh.calls[1] as { branch: string }).branch).toBe("verdict/cleanup-my_flag-2-9");
  });

  it("refuses a flag name the codemod cannot handle safely (a dot) and opens nothing", async () => {
    const gh = fakeGitHub(SOURCE.replace("my_flag", "My.Flag"));
    const { execute } = setup({ detail: completed({ feature: { name: "My.Flag", multivariate_options: [{ id: 11, key: "v", string_value: "variant_a" }] } }), github: gh.api });
    const out = (await execute("open_cleanup_pr", input)) as { refused?: boolean };
    expect(out.refused).toBe(true);
    expect(gh.calls.filter((c) => c.op === "openPullRequest")).toHaveLength(0);
  });
});

describe("cleanup in a CONNECTED repo (someone else's project)", () => {
  const conn = { ...connectionFromEnv({} as NodeJS.ProcessEnv), githubToken: "t", githubRepo: "shop/site", cleanupPath: "src/components/", flagsmithApiKey: "k", environmentKey: "e" };

  function setupRepo(gh: GitHubApi) {
    const deps: ToolDeps = {
      conn,
      request: (async () => completed()) as ToolDeps["request"],
      loadDecision: async () => ({ decision: referee(REPLAY_SCENARIOS.B), snapshot: REPLAY_SCENARIOS.B }),
      files: { read: async () => { throw new Error("must not read local files for a connected repo"); }, listDemo: async () => [] },
      github: () => gh,
    };
    return makeExecutor(deps);
  }

  it("searches the connected repo's cleanup folder, not this repo", async () => {
    const gh = fakeGitHub(SOURCE, ["src/components/Buy.jsx", "src/other/X.tsx", "README.md"]);
    const out = (await setupRepo(gh.api)("find_flag_references", { flag_name: "my_flag" })) as {
      searched: string;
      references: { path: string }[];
    };
    expect(out.searched).toBe("shop/site:src/components/");
    expect(out.references.map((r) => r.path)).toEqual(["src/components/Buy.jsx"]);
    expect(gh.calls[0]).toEqual({ op: "listFiles", prefix: "src/components/" });
  });

  it("opens the PR for a file in that folder, and refuses one outside it", async () => {
    const gh = fakeGitHub(SOURCE, ["src/components/Buy.jsx"]);
    const exec = setupRepo(gh.api);
    const ok = (await exec("open_cleanup_pr", { experiment_id: 9, file_path: "src/components/Buy.jsx" })) as { mode: string };
    expect(ok.mode).toBe("pull_request");
    const no = (await exec("open_cleanup_pr", { experiment_id: 9, file_path: "app/demo/b.tsx" })) as { refused?: boolean; reason: string };
    expect(no.refused).toBe(true);
    expect(no.reason).toMatch(/src\/components\//);
  });
});

describe("create_feature never lists the control as a variant", () => {
  const exec = makeExecutor({
    loadDecision: async () => { throw new Error("unused"); },
    request: (async () => { throw new Error("must not be called"); }) as ToolDeps["request"],
  });

  it("rejects a variant whose key or value is 'control', before calling Flagsmith", async () => {
    for (const variants of [
      [{ key: "control", value: "black" }],
      [{ key: "Black", value: "Control" }],
      [{ key: "white", value: "white" }, { key: "x", value: " CONTROL " }],
    ]) {
      await expect(exec("create_feature", { name: "f", variants })).rejects.toThrow(/created automatically/);
    }
  });
});
