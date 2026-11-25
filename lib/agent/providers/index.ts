import type { CallModel } from "../types";
import { callAnthropic } from "./anthropic";
import { callGemini } from "./gemini";

/** AGENT_PROVIDER=gemini (default, free tier) or anthropic. */
export const callModel: CallModel = (history) =>
  process.env.AGENT_PROVIDER === "anthropic" ? callAnthropic(history) : callGemini(history);
