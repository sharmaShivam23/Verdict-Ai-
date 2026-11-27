import type { Connection } from "../../connection";
import type { CallModel } from "../types";
import { callAnthropic } from "./anthropic";
import { geminiFor } from "./gemini";

/** AGENT_PROVIDER=gemini (default, free tier) or anthropic (server-wide, .env.local only). */
export function modelFor(conn: Connection): CallModel {
  if (conn.source === "env" && process.env.AGENT_PROVIDER === "anthropic") return callAnthropic;
  return geminiFor(conn.geminiApiKey, conn.geminiModel);
}

/** Env-configured model, for scripts. */
export const callModel: CallModel = (history) =>
  process.env.AGENT_PROVIDER === "anthropic" ? callAnthropic(history) : geminiFor(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL)(history);
