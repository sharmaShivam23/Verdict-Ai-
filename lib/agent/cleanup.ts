// Cleanup step of the closed loop: once an experiment has a decided winner, the
// losing code path is removed. This is a deterministic codemod for ONE
// convention, not a general refactoring engine:
//
//   const label = pick(useExperiment("my_flag"), { control: "A", variant_a: "B" });
//
// becomes (keeping the winner's branch):
//
//   const label = "B";
//
// plus removal of imports that are no longer used. Anything it does not
// recognise is refused with a reason instead of guessed at.

import { DEFAULT_CLEANUP_PATH } from "../connection";
import type { Decision, ExperimentSnapshot } from "../types";

export class CleanupError extends Error {}

/**
 * Where cleanup may touch files: inside ONE folder (the connection's cleanup
 * path, "app/demo/" by default), only .ts/.tsx/.js/.jsx source files, no hidden
 * segments, no "..", no doubled slashes.
 */
export function isAllowedCleanupPath(p: string, prefix: string = DEFAULT_CLEANUP_PATH): boolean {
  if (!p.startsWith(prefix)) return false;
  if (!/^[A-Za-z0-9_\-/.]+\.(tsx?|jsx?)$/.test(p)) return false;
  if (p.includes("//")) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== ".." && !seg.startsWith("."));
}

// ---------- which branch to keep ----------

export interface ExperimentOutcome {
  status?: string;
  rollout_decision?: string | null;
  rollout_variant?: number | null;
  feature: { name?: string; multivariate_options: { id: number; string_value: string | null }[] };
}

export type KeptBranch =
  | { ok: true; keepValue: string; reason: string }
  | { ok: false; reason: string };

const NOT_FINISHED = new Set(["running", "created", "draft", "paused"]);

/**
 * Derives the branch to keep from the experiment's RECORDED rollout decision,
 * never from the model's say-so. Cleanup is only allowed once the experiment
 * has been completed (which itself required a SHIP verdict for a variant).
 */
export function keptBranchFor(e: ExperimentOutcome): KeptBranch {
  if (!e.rollout_decision) {
    return { ok: false, reason: "Refused: this experiment has no recorded rollout decision. Complete it first." };
  }
  if (e.status && NOT_FINISHED.has(e.status)) {
    return { ok: false, reason: `Refused: the experiment is still "${e.status}", not completed.` };
  }
  if (e.rollout_decision === "control") {
    return { ok: true, keepValue: "control", reason: "The experiment was completed with the control." };
  }
  if (e.rollout_decision === "variant") {
    const opt = e.feature.multivariate_options.find((o) => o.id === e.rollout_variant);
    if (!opt?.string_value) {
      return { ok: false, reason: "Refused: could not find the rolled-out variation's value." };
    }
    return { ok: true, keepValue: opt.string_value, reason: "The experiment was completed with this variation." };
  }
  return {
    ok: false,
    reason: `Refused: rollout decision "${e.rollout_decision}" leaves the flag disabled, which has no single code path to keep.`,
  };
}

// ---------- the codemod ----------

interface Parsed<T> {
  value: T;
  end: number;
}

function skipSpace(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

function parseStringLiteral(s: string, i: number): Parsed<string> {
  const q = s[i];
  if (q !== '"' && q !== "'") throw new CleanupError("Only plain string branches are supported (no template literals or expressions).");
  let j = i + 1;
  while (j < s.length && s[j] !== q) {
    if (s[j] === "\\") j++;
    j++;
  }
  if (j >= s.length) throw new CleanupError("Unterminated string literal.");
  const raw = s.slice(i + 1, j);
  const value = q === '"' ? (JSON.parse(`"${raw}"`) as string) : raw.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  return { value, end: j + 1 };
}

function parseKey(s: string, i: number): Parsed<string> {
  if (s[i] === '"' || s[i] === "'") return parseStringLiteral(s, i);
  const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(s.slice(i));
  if (!m) throw new CleanupError("Unsupported key in the branches object.");
  return { value: m[0], end: i + m[0].length };
}

function parseBranches(s: string, openBrace: number): Parsed<Map<string, string>> {
  const entries = new Map<string, string>();
  let i = skipSpace(s, openBrace + 1);
  while (s[i] !== "}") {
    const key = parseKey(s, i);
    i = skipSpace(s, key.end);
    if (s[i] !== ":") throw new CleanupError("Expected ':' in the branches object.");
    i = skipSpace(s, i + 1);
    const val = parseStringLiteral(s, i);
    entries.set(key.value, val.value);
    i = skipSpace(s, val.end);
    if (s[i] === ",") i = skipSpace(s, i + 1);
    else if (s[i] !== "}") throw new CleanupError("Expected ',' or '}' in the branches object.");
  }
  return { value: entries, end: i + 1 };
}

const escapeRegex = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function removeUnusedImports(code: string, names: string[]): string {
  const importLine = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+(["'][^"']+["']);?[ \t]*\r?\n?/gm;
  const withoutImports = code.replace(importLine, "");
  let out = code;
  for (const name of names) {
    if (new RegExp(`\\b${escapeRegex(name)}\\b`).test(withoutImports)) continue; // still used
    out = out.replace(importLine, (line, typeKw: string | undefined, list: string, from: string) => {
      const items = list.split(",").map((x) => x.trim()).filter(Boolean);
      if (!items.some((it) => it === name || it.endsWith(` as ${name}`))) return line;
      const rest = items.filter((it) => it !== name && !it.endsWith(` as ${name}`));
      if (rest.length === 0) return "";
      return `import ${typeKw ?? ""}{ ${rest.join(", ")} } from ${from};\n`;
    });
  }
  return out;
}

export interface CleanupResult {
  code: string;
  /** The literal that replaced each call. */
  keptLiteral: string;
  replacements: number;
}

export function applyCleanup(source: string, flag: string, keepValue: string): CleanupResult {
  if (!/^[A-Za-z0-9_\-]+$/.test(flag)) throw new CleanupError(`Unsupported flag name "${flag}".`);
  const start = new RegExp(`pick\\(\\s*useExperiment\\(\\s*(["'])${escapeRegex(flag)}\\1\\s*\\)\\s*,\\s*\\{`, "g");

  let out = "";
  let cursor = 0;
  let replacements = 0;
  let keptLiteral = "";
  for (let m = start.exec(source); m; m = start.exec(source)) {
    const braceAt = m.index + m[0].length - 1;
    const parsed = parseBranches(source, braceAt);
    let close = skipSpace(source, parsed.end);
    if (source[close] === ",") close = skipSpace(source, close + 1); // trailing comma
    if (source[close] !== ")") throw new CleanupError("Expected ')' after the branches object. Is there a third argument?");
    if (!parsed.value.has("control")) throw new CleanupError('The branches object has no "control" entry.');
    const kept = parsed.value.get(keepValue);
    if (kept === undefined) {
      throw new CleanupError(`The branches object has no "${keepValue}" entry (found: ${[...parsed.value.keys()].join(", ")}).`);
    }
    keptLiteral = JSON.stringify(kept);
    out += source.slice(cursor, m.index) + keptLiteral;
    cursor = close + 1;
    replacements++;
    start.lastIndex = cursor;
  }
  if (replacements === 0) {
    throw new CleanupError(`No pick(useExperiment("${flag}"), {...}) call found in this file.`);
  }
  out += source.slice(cursor);
  return { code: removeUnusedImports(out, ["useExperiment", "pick"]), keptLiteral, replacements };
}

/** Lines in a file that reference the flag, for the read-only finder tool. */
export function findReferences(
  files: { path: string; content: string }[],
  flag: string,
): { path: string; line: number; text: string }[] {
  const needle = new RegExp(`useExperiment\\(\\s*["']${escapeRegex(flag)}["']\\s*\\)`);
  const hits: { path: string; line: number; text: string }[] = [];
  for (const f of files) {
    f.content.split(/\r?\n/).forEach((text, i) => {
      if (needle.test(text)) hits.push({ path: f.path, line: i + 1, text: text.trim() });
    });
  }
  return hits;
}

// ---------- diff and PR text ----------

/** Minimal unified diff (LCS on lines, 2 lines of context). Enough for a human-readable PR preview. */
export function unifiedDiff(path: string, before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const ops: { t: " " | "-" | "+"; s: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: " ", s: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ t: "-", s: a[i++] });
    else ops.push({ t: "+", s: b[j++] });
  }
  while (i < n) ops.push({ t: "-", s: a[i++] });
  while (j < m) ops.push({ t: "+", s: b[j++] });

  const changed = ops.map((o, k) => (o.t === " " ? -1 : k)).filter((k) => k >= 0);
  if (changed.length === 0) return "";
  const keep = new Set<number>();
  for (const k of changed) for (let d = -2; d <= 2; d++) if (k + d >= 0 && k + d < ops.length) keep.add(k + d);
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  let prev = -2;
  for (const k of [...keep].sort((x, y) => x - y)) {
    if (k !== prev + 1) lines.push("@@");
    lines.push(ops[k].t + ops[k].s);
    prev = k;
  }
  return lines.join("\n");
}

export function prBody(args: {
  flag: string;
  experimentId: number;
  keptValue: string;
  filePath: string;
  decision?: Decision;
  snapshot?: ExperimentSnapshot;
}): string {
  const { flag, experimentId, keptValue, filePath, decision, snapshot } = args;
  const out = [
    `## Remove experiment code for \`${flag}\``,
    "",
    `Experiment #${experimentId} was completed and the winning branch is \`${keptValue}\`. This PR deletes the losing code path in \`${filePath}\` and the now-unused imports. Opened by Verdict after human approval; please review before merging.`,
    "",
  ];
  if (decision && snapshot) {
    out.push(`### What the Referee said (${snapshot.name})`, "", `**Verdict: ${decision.verdict}**. ${decision.headline}`, "");
    for (const c of decision.checks) out.push(`- ${c.status.toUpperCase()}: ${c.label}. ${c.detail}`);
    out.push("", "**Still uncertain:**", ...decision.uncertainties.map((u) => `- ${u}`), "");
    if (snapshot.synthetic) {
      out.push("> **Disclosure:** the traffic behind this experiment was SIMULATED (identities `sim-*`). It says nothing about real users.", "");
    }
  } else {
    out.push("_The Referee's results could not be loaded when this PR was opened._", "");
  }
  out.push("This PR only touches `app/demo/`. CI must pass before merging.");
  return out.join("\n");
}
