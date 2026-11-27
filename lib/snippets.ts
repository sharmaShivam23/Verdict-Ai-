// Generates the code a website owner pastes into THEIR site so that Flagsmith
// can split their visitors and count what they do. Pure functions, no secrets:
// the environment key is Flagsmith's client-side key, which is public by design.

export const SDK_VERSION = "12.6.0";
export const SDK_CDN = `https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@${SDK_VERSION}/index.js`;

export interface SnippetInput {
  environmentKey: string;
  flag: string;
  /** The event the experiment's metric counts, e.g. "sign_up_click". */
  event: string;
  /** The NEW versions to test. The current version is always "control". */
  versions: string[];
}

const NAME = /^[A-Za-z0-9_-]{1,60}$/;
const KEY = /^[A-Za-z0-9]{8,64}$/;

export type Validation = { ok: true; value: SnippetInput } | { ok: false; error: string };

export function validateSnippetInput(i: SnippetInput): Validation {
  if (!KEY.test(i.environmentKey)) return { ok: false, error: "The environment key should be letters and digits only (Flagsmith, SDK Keys, client-side key)." };
  if (!NAME.test(i.flag)) return { ok: false, error: "The flag name can use letters, digits, - and _ only." };
  if (!NAME.test(i.event)) return { ok: false, error: "The event name can use letters, digits, - and _ only." };
  const versions = i.versions.map((v) => v.trim()).filter(Boolean);
  if (versions.length === 0) return { ok: false, error: "Add at least one new version to test, for example white." };
  if (new Set(versions).size !== versions.length) return { ok: false, error: "Each version name must be different." };
  if (versions.includes("control")) return { ok: false, error: 'Do not list "control". Your current version is the control automatically.' };
  if (versions.some((v) => !NAME.test(v))) return { ok: false, error: "Version names can use letters, digits, - and _ only." };
  return { ok: true, value: { ...i, versions } };
}

const q = (s: string) => JSON.stringify(s);

/** Plain HTML: works on any website, no build step. */
export function htmlSnippet(i: SnippetInput): string {
  const css = ["control", ...i.versions]
    .map((v) => `[data-version=${q(v)}] .cta { /* style for the ${v} version */ }`)
    .join("\n    ");
  return `<!-- 1. Put this just before </body> on the page you are testing -->
<script src="${SDK_CDN}"></script>
<script>
(function () {
  var ENV_KEY = ${q(i.environmentKey)};   // your Flagsmith client-side key (public)
  var FLAG    = ${q(i.flag)};
  var GOAL    = ${q(i.event)};

  // One stable id per visitor, so each person always sees the same version.
  var id = localStorage.getItem("verdict_visitor");
  if (!id) {
    id = "web-" + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    localStorage.setItem("verdict_visitor", id);
  }

  var flagsmith = window.index.createFlagsmithInstance();
  flagsmith.init({ environmentID: ENV_KEY, identity: id, enableEvents: true }).then(function () {
    // Asks Flagsmith which version this visitor gets AND records that they saw it.
    var flag = flagsmith.getExperimentFlag(FLAG);
    var version = (flag && flag.enabled && flag.value) || "control";
    document.documentElement.setAttribute("data-version", version);
  });

  // 2. Call verdictGoal() when the visitor does the thing you want more of.
  window.verdictGoal = function () {
    flagsmith.trackEvent(GOAL);
    flagsmith.flushEvents();   // send now, in case the click leaves the page
  };
})();
</script>

<!-- 3. Style each version (CSS). Anything not listed keeps your current look. -->
<style>
    ${css}
</style>

<!-- 4. Add the goal to your button -->
<a class="cta" href="/signup" onclick="verdictGoal()">Sign up</a>`;
}

/** React / Next.js. Uses the one pattern Verdict's cleanup step can remove later. */
export function reactSnippets(i: SnippetInput): { install: string; provider: string; usage: string; helper: string } {
  const branches = ["control", ...i.versions].map((v) => `${q(v)}: ${q(v)}`).join(", ");
  return {
    install: "npm install @flagsmith/flagsmith",
    provider: `"use client";
import flagsmith from "@flagsmith/flagsmith";
import { FlagsmithProvider } from "@flagsmith/flagsmith/react";
import { useState } from "react";

// A stable id per visitor, so each person always sees the same version.
function visitorId() {
  let id = localStorage.getItem("verdict_visitor");
  if (!id) {
    id = "web-" + crypto.randomUUID();
    localStorage.setItem("verdict_visitor", id);
  }
  return id;
}

export default function ExperimentProvider({ children }: { children: React.ReactNode }) {
  const [id] = useState(visitorId);
  return (
    <FlagsmithProvider
      flagsmith={flagsmith}
      options={{ environmentID: ${q(i.environmentKey)}, identity: id, enableEvents: true }}
    >
      {children}
    </FlagsmithProvider>
  );
}`,
    usage: `"use client";
import { useExperiment, useFlagsmith } from "@flagsmith/flagsmith/react";
import { pick } from "@/lib/experiment";

export default function SignUpButton() {
  const flagsmith = useFlagsmith();

  // Asks Flagsmith which version this visitor gets AND records that they saw it.
  const theme = pick(useExperiment(${q(i.flag)}), { ${branches} });

  return (
    <button data-theme={theme} onClick={() => flagsmith.trackEvent(${q(i.event)})}>
      Sign up
    </button>
  );
}`,
    helper: `// lib/experiment.ts: falls back to "control" if the flag is missing, off or unknown.
export function pick<T>(
  flag: { enabled?: boolean; value?: unknown } | null | undefined,
  branches: { control: T } & Record<string, T>,
): T {
  if (!flag || flag.enabled === false || typeof flag.value !== "string") return branches.control;
  return Object.hasOwn(branches, flag.value) ? branches[flag.value] : branches.control;
}`,
  };
}
