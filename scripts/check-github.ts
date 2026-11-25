// Read-only check that GITHUB_TOKEN can reach GITHUB_REPO. Prints no secrets.
// Usage: npx tsx --env-file=.env.local scripts/check-github.ts

import { isValidRepo } from "../lib/github/client";

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPO must both be set in .env.local");
  if (!isValidRepo(repo)) throw new Error('GITHUB_REPO must look like "owner/name"');

  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  console.log(`GET /repos/${repo} -> HTTP ${res.status}`);
  const j = (await res.json()) as { message?: string; default_branch?: string; private?: boolean; permissions?: Record<string, boolean> };
  if (!res.ok) {
    console.log(`GitHub says: ${j.message}`);
    console.log(`Accepted permissions header: ${res.headers.get("x-accepted-github-permissions") ?? "(none)"}`);
    process.exitCode = 1;
    return;
  }
  console.log(`default branch: ${j.default_branch}, private: ${j.private}`);
  console.log(`permissions on this repo: ${JSON.stringify(j.permissions)}`);

  // Can it read the demo file the cleanup will edit?
  const f = await fetch(`https://api.github.com/repos/${repo}/contents/app/demo/checkout-button.tsx?ref=${j.default_branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  console.log(`GET contents/app/demo/checkout-button.tsx -> HTTP ${f.status}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
