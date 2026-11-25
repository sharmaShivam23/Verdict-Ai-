// Smoke test: sends ONE message through the real agent loop (real model, real
// Flagsmith reads). It cannot approve anything, so any write tool just pauses.
// Usage: npx tsx --env-file=.env.local scripts/agent-smoke.ts "your question"

import { newSession, sendUserMessage } from "../lib/agent/loop";
import { callModel } from "../lib/agent/providers";
import { executeTool } from "../lib/agent/tools";

async function main() {
  const message = process.argv[2] ?? "Is experiment 406 ready to ship?";
  const session = newSession("smoke");
  const result = await sendUserMessage(session, message, { callModel, execute: executeTool });

  console.log(`provider: ${process.env.AGENT_PROVIDER ?? "gemini"}`);
  console.log(`status: ${result.status}${result.message ? ` (${result.message})` : ""}`);
  for (const e of session.log) console.log(`[${e.kind}] ${e.text}`);
  if (session.pending.length) {
    console.log("\nPENDING APPROVAL (not executed):");
    for (const p of session.pending) console.log(`- ${p.risk}: ${p.summary}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
