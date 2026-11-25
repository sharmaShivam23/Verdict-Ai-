// Gemini adapter: neutral history <-> Google GenAI `generateContent`.
// Field names were checked against the installed @google/genai type
// definitions (FunctionCall.id is optional, FunctionResponse.response is an
// object with "output"/"error" keys, thoughtSignature lives on Part,
// automaticFunctionCalling.disable turns off the SDK's own loop).

import {
  ApiError,
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type Part as GPart,
} from "@google/genai";
import { SYSTEM_PROMPT } from "../prompt";
import { TOOLS } from "../tools";
import type { CallModel, ChatMessage, ModelTurn } from "../types";

/** Overridable. Run `npx tsx --env-file=.env.local scripts/list-gemini-models.ts` to see what your key can use. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

/** Gemini may omit function call ids; ours start with this so we never echo one back. */
const SYNTHETIC_ID = "gm_";

export function toGeminiTools(tools = TOOLS) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.input_schema,
      })),
    },
  ];
}

export function toGeminiContents(history: ChatMessage[]): Content[] {
  return history.map((m): Content => {
    if (m.role === "assistant") {
      // Replay the model's own content unchanged (keeps thought signatures).
      if (m.raw) return m.raw as Content;
      const parts: GPart[] = [];
      for (const p of m.parts) {
        if (p.type === "text") parts.push({ text: p.text });
        else if (p.type === "tool_call") {
          parts.push({
            functionCall: {
              ...(p.id.startsWith(SYNTHETIC_ID) ? {} : { id: p.id }),
              name: p.name,
              args: p.input as Record<string, unknown>,
            },
          });
        }
      }
      return { role: "model", parts };
    }
    const parts: GPart[] = [];
    for (const p of m.parts) {
      if (p.type === "text") parts.push({ text: p.text });
      else if (p.type === "tool_result") {
        parts.push({
          functionResponse: {
            ...(p.id.startsWith(SYNTHETIC_ID) ? {} : { id: p.id }),
            name: p.name,
            response: p.isError ? { error: p.payload } : { output: p.payload },
          },
        });
      }
    }
    return { role: "user", parts };
  });
}

const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY", "RECITATION"]);
const BROKEN_CALL = new Set(["MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL"]);

export function fromGeminiResponse(
  res: Pick<GenerateContentResponse, "candidates" | "promptFeedback">,
  newId: () => string = () => `${SYNTHETIC_ID}${crypto.randomUUID()}`,
): ModelTurn {
  const candidate = res.candidates?.[0];
  if (!candidate?.content) {
    const reason = res.promptFeedback?.blockReason ?? candidate?.finishReason ?? "no candidate";
    return {
      message: { role: "assistant", parts: [] },
      stop: "refusal",
      note: `Gemini returned no answer (${reason}).`,
    };
  }

  const parts: ChatMessage["parts"] = [];
  let hasCall = false;
  for (const p of candidate.content.parts ?? []) {
    if (p.functionCall?.name) {
      hasCall = true;
      parts.push({
        type: "tool_call",
        id: p.functionCall.id ?? newId(),
        name: p.functionCall.name,
        input: p.functionCall.args ?? {},
      });
    } else if (typeof p.text === "string" && p.text && !p.thought) {
      parts.push({ type: "text", text: p.text });
    }
  }

  const message: ChatMessage = { role: "assistant", parts, raw: candidate.content };
  const reason = String(candidate.finishReason ?? "");
  if (hasCall) return { message, stop: "tool_use" };
  if (reason === "MAX_TOKENS") return { message, stop: "max_tokens" };
  if (BLOCKED.has(reason)) return { message, stop: "refusal", note: `Gemini declined this request (${reason}).` };
  if (BROKEN_CALL.has(reason)) {
    return { message, stop: "other", note: `Gemini produced an invalid tool call (${reason}). Try rephrasing.` };
  }
  return { message, stop: "end" };
}

/** Turns SDK errors into messages a person can act on. Never includes the key. */
export function friendlyGeminiError(e: unknown): Error {
  if (e instanceof ApiError) {
    if (e.status === 429) {
      return new Error("Gemini rate limit reached (free tier). Wait a minute and try again, or pick a different GEMINI_MODEL.");
    }
    if (e.status === 404) {
      return new Error("Gemini model not found. Set GEMINI_MODEL to one your key can use (run scripts/list-gemini-models.ts).");
    }
    if (e.status === 400 || e.status === 401 || e.status === 403) {
      return new Error(`Gemini rejected the request (HTTP ${e.status}). Check GEMINI_API_KEY and GEMINI_MODEL. ${e.message.slice(0, 200)}`);
    }
    return new Error(`Gemini error (HTTP ${e.status}): ${e.message.slice(0, 200)}`);
  }
  return e instanceof Error ? e : new Error("Unknown Gemini error");
}

let client: GoogleGenAI | undefined;

export const callGemini: CallModel = async (history) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it to .env.local (get a free key in Google AI Studio).");
  client ??= new GoogleGenAI({ apiKey });
  try {
    const res = await client.models.generateContent({
      model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      contents: toGeminiContents(history),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: toGeminiTools(),
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        // We run the loop ourselves so every change can wait for approval.
        automaticFunctionCalling: { disable: true },
        maxOutputTokens: 8192,
      },
    });
    return fromGeminiResponse(res);
  } catch (e) {
    throw friendlyGeminiError(e);
  }
};
