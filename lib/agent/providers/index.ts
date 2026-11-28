import type { Connection } from "../../connection";
import type { CallModel } from "../types";
import { callAnthropic } from "./anthropic";
import { geminiFor } from "./gemini";

/**
 * Which Gemini key and model a request uses: the person's own if they saved one,
 * otherwise this server's GEMINI_API_KEY (the owner's choice: everyone can try the
 * agent without their own key). The shared key only lets the agent talk to the
 * model; it gives no access to anyone's Flagsmith project or repo. Set
 * VERDICT_DISABLE_SHARED_MODEL=1 to require everyone to bring their own key.
 */
export function resolveGemini(
  conn: Pick<Connection, "geminiApiKey" | "geminiModel">,
  env: NodeJS.ProcessEnv = process.env,
): { apiKey?: string; model?: string; shared: boolean } {
  if (conn.geminiApiKey) return { apiKey: conn.geminiApiKey, model: conn.geminiModel, shared: false };
  const key = env.GEMINI_API_KEY?.trim();
  if (key && env.VERDICT_DISABLE_SHARED_MODEL !== "1") {
    return { apiKey: key, model: env.GEMINI_MODEL?.trim() || undefined, shared: true };
  }
  return { shared: false };
}

/** AGENT_PROVIDER=gemini (default, free tier) or anthropic (server-wide, .env.local only). */
export function modelFor(conn: Connection): CallModel {
  if (conn.source === "env" && process.env.AGENT_PROVIDER === "anthropic") return callAnthropic;
  const g = resolveGemini(conn);
  return geminiFor(g.apiKey, g.model);
}

/** Env-configured model, for scripts. */
export const callModel: CallModel = (history) =>
  process.env.AGENT_PROVIDER === "anthropic" ? callAnthropic(history) : geminiFor(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL)(history);
