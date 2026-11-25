// Minimal GitHub REST client for opening a cleanup pull request. Server-side
// only. The token is read from the environment and never put in an error.
// Needs a fine-grained token limited to ONE repo with Contents (read and write)
// and Pull requests (read and write).

export interface GitHubApi {
  /** Reads a file from the default branch. */
  getFile(path: string): Promise<{ content: string; sha: string; defaultBranch: string }>;
  /** Creates a branch off the default branch, commits the file to it, opens a PR. Returns the PR URL. */
  openPullRequest(args: {
    branch: string;
    path: string;
    newContent: string;
    fileSha: string;
    defaultBranch: string;
    commitMessage: string;
    title: string;
    body: string;
  }): Promise<{ url: string; number: number }>;
}

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** "owner/name", where neither part is empty or made only of dots (".." would walk out of /repos/). */
export function isValidRepo(repo: string): boolean {
  if (!REPO_RE.test(repo)) return false;
  return repo.split("/").every((part) => !/^\.+$/.test(part));
}

export function githubFromEnv(fetchImpl: typeof fetch = fetch): GitHubApi | null {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return null;
  if (!isValidRepo(repo)) throw new GitHubError(0, 'GITHUB_REPO must look like "owner/name".');
  return createGitHubApi(token, repo, fetchImpl);
}

export function createGitHubApi(token: string, repo: string, fetchImpl: typeof fetch = fetch): GitHubApi {
  const base = `https://api.github.com/repos/${repo}`;

  async function gh<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { message?: string }).message ?? "";
      } catch {
        /* ignore */
      }
      // GitHub tells us which permission an endpoint needs; surface it on 403/404.
      const needs = res.headers.get("x-accepted-github-permissions");
      const hint =
        res.status === 403 || res.status === 404
          ? ` (token may be missing access to ${repo}${needs ? `; this endpoint needs: ${needs}` : ""})`
          : "";
      throw new GitHubError(res.status, `GitHub ${init.method ?? "GET"} ${path.split("?")[0]} failed: HTTP ${res.status}${detail ? ` - ${detail}` : ""}${hint}`);
    }
    return (await res.json()) as T;
  }

  const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

  return {
    async getFile(path) {
      const repoInfo = await gh<{ default_branch: string }>("");
      const f = await gh<{ content: string; sha: string; encoding: string }>(
        `/contents/${encodePath(path)}?ref=${encodeURIComponent(repoInfo.default_branch)}`,
      );
      if (f.encoding !== "base64") throw new GitHubError(0, `Unexpected encoding "${f.encoding}" for ${path}.`);
      return { content: Buffer.from(f.content, "base64").toString("utf8"), sha: f.sha, defaultBranch: repoInfo.default_branch };
    },

    async openPullRequest(a) {
      const ref = await gh<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(a.defaultBranch)}`);
      await gh("/git/refs", { method: "POST", body: { ref: `refs/heads/${a.branch}`, sha: ref.object.sha } });
      await gh(`/contents/${encodePath(a.path)}`, {
        method: "PUT",
        body: {
          message: a.commitMessage,
          content: Buffer.from(a.newContent, "utf8").toString("base64"),
          sha: a.fileSha,
          branch: a.branch,
        },
      });
      const pr = await gh<{ html_url: string; number: number }>("/pulls", {
        method: "POST",
        body: { title: a.title, head: a.branch, base: a.defaultBranch, body: a.body },
      });
      return { url: pr.html_url, number: pr.number };
    },
  };
}
