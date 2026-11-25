import { afterEach, describe, expect, it } from "vitest";
import { createGitHubApi, GitHubError, githubFromEnv } from "./client";

type Call = { url: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> };

function fakeFetch(handler: (c: Call) => { status?: number; json?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const r = handler(call);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.json ?? {}, headers: new Headers(r.headers) } as unknown as Response;
  }) as typeof fetch;
  return { calls, impl };
}

const TOKEN = "ghp_SECRET_TOKEN_VALUE_123";
const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("GitHub client", () => {
  it("reads the file from the default branch", async () => {
    const f = fakeFetch((c) => {
      if (c.url.endsWith("/repos/o/r")) return { json: { default_branch: "main" } };
      return { json: { content: b64("hello"), sha: "S1", encoding: "base64" } };
    });
    const api = createGitHubApi(TOKEN, "o/r", f.impl);
    expect(await api.getFile("app/demo/a b.tsx")).toEqual({ content: "hello", sha: "S1", defaultBranch: "main" });
    expect(f.calls[1].url).toBe("https://api.github.com/repos/o/r/contents/app/demo/a%20b.tsx?ref=main");
    expect(f.calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(f.calls[0].headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("opens a PR in the right order: branch, commit, pull request", async () => {
    const f = fakeFetch((c) => {
      if (c.url.endsWith("/git/ref/heads/main")) return { json: { object: { sha: "BASE" } } };
      if (c.url.endsWith("/pulls")) return { json: { html_url: "https://github.com/o/r/pull/3", number: 3 } };
      return { json: {} };
    });
    const api = createGitHubApi(TOKEN, "o/r", f.impl);
    const pr = await api.openPullRequest({
      branch: "verdict/cleanup-x-1", path: "app/demo/a.tsx", newContent: "new", fileSha: "S1",
      defaultBranch: "main", commitMessage: "msg", title: "T", body: "B",
    });
    expect(pr).toEqual({ url: "https://github.com/o/r/pull/3", number: 3 });
    expect(f.calls.map((c) => `${c.method} ${c.url.replace("https://api.github.com/repos/o/r", "")}`)).toEqual([
      "GET /git/ref/heads/main",
      "POST /git/refs",
      "PUT /contents/app/demo/a.tsx",
      "POST /pulls",
    ]);
    expect(f.calls[1].body).toEqual({ ref: "refs/heads/verdict/cleanup-x-1", sha: "BASE" });
    expect(f.calls[2].body).toEqual({ message: "msg", content: b64("new"), sha: "S1", branch: "verdict/cleanup-x-1" });
    expect(f.calls[3].body).toEqual({ title: "T", head: "verdict/cleanup-x-1", base: "main", body: "B" });
  });

  it("explains a permission failure using GitHub's own header, and never leaks the token", async () => {
    const f = fakeFetch(() => ({ status: 403, json: { message: "Resource not accessible by personal access token" }, headers: { "x-accepted-github-permissions": "contents=write" } }));
    const api = createGitHubApi(TOKEN, "o/r", f.impl);
    const err = await api
      .openPullRequest({ branch: "b", path: "p", newContent: "n", fileSha: "s", defaultBranch: "main", commitMessage: "m", title: "t", body: "b" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    const msg = (err as Error).message;
    expect(msg).toMatch(/HTTP 403/);
    expect(msg).toMatch(/contents=write/);
    expect(msg).not.toContain(TOKEN);
  });

  it("surfaces a branch-already-exists failure clearly", async () => {
    const f = fakeFetch((c) => {
      if (c.url.endsWith("/git/ref/heads/main")) return { json: { object: { sha: "BASE" } } };
      return { status: 422, json: { message: "Reference already exists" } };
    });
    const err = (await createGitHubApi(TOKEN, "o/r", f.impl)
      .openPullRequest({ branch: "b", path: "p", newContent: "n", fileSha: "s", defaultBranch: "main", commitMessage: "m", title: "t", body: "b" })
      .catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/422.*Reference already exists/);
  });
});

describe("githubFromEnv", () => {
  const saved = { t: process.env.GITHUB_TOKEN, r: process.env.GITHUB_REPO };
  afterEach(() => {
    if (saved.t === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = saved.t;
    if (saved.r === undefined) delete process.env.GITHUB_REPO; else process.env.GITHUB_REPO = saved.r;
  });

  it("is null when not configured, and rejects a malformed repo", () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPO;
    expect(githubFromEnv()).toBeNull();
    process.env.GITHUB_TOKEN = "x";
    process.env.GITHUB_REPO = "not a repo";
    expect(() => githubFromEnv()).toThrow(/owner\/name/);
    for (const bad of ["../evil", "owner/..", "./x", "a/b/c", "/x", "x/"]) {
      process.env.GITHUB_REPO = bad;
      expect(() => githubFromEnv(), bad).toThrow(GitHubError);
    }
    process.env.GITHUB_REPO = "owner/name";
    expect(githubFromEnv()).not.toBeNull();
  });
});
