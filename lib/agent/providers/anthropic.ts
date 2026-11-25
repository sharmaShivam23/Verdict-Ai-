// Claude adapter: neutral history <-> Anthropic Messages API (beta endpoint).
// Opus 5.5: thinking is always on (omit the param), effort defaults to medium
// so it is set explicitly, forced tool_choice is rejected, and a server-side
// refusal fallback is enabled by default.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "../prompt";
import { TOOLS } from "../tools";
import type { CallModel, ChatMessage, ModelTurn, StopReason } from "../types";

export const ANTHROPIC_MODEL = "claude-opus-5-5";

type Msg = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlockParam;

const asText = (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x));

export function toAnthropicMessages(history: ChatMessage[]): Msg[] {
  return history.map((m): Msg => {
    if (m.role === "assistant") {
      // Replay the provider's own content unchanged (keeps thinking blocks).
      if (m.raw) return { role: "assistant", content: m.raw as Block[] };
      const blocks: Block[] = [];
      for (const p of m.parts) {
        if (p.type === "text") blocks.push({ type: "text", text: p.text });
        else if (p.type === "tool_call") {
          blocks.push({ type: "tool_use", id: p.id, name: p.name, input: p.input as Record<string, unknown> });
        }
      }
      return { role: "assistant", content: blocks };
    }
    const blocks: Block[] = [];
    for (const p of m.parts) {
      if (p.type === "text") blocks.push({ type: "text", text: p.text });
      else if (p.type === "tool_result") {
        blocks.push({ type: "tool_result", tool_use_id: p.id, content: asText(p.payload), is_error: p.isError });
      }
    }
    return { role: "user", content: blocks };
  });
}

const STOP: Record<string, StopReason> = {
  end_turn: "end",
  stop_sequence: "end",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  refusal: "refusal",
};

export function fromAnthropicMessage(res: {
  stop_reason: string | null;
  content: Array<{ type: string } & Record<string, unknown>>;
}): ModelTurn {
  const parts: ChatMessage["parts"] = [];
  for (const b of res.content) {
    if (b.type === "text" && typeof b.text === "string") {
      parts.push({ type: "text", text: b.text });
    } else if (b.type === "tool_use") {
      parts.push({ type: "tool_call", id: String(b.id), name: String(b.name), input: b.input });
    }
  }
  const stop = STOP[res.stop_reason ?? ""] ?? "other";
  return {
    message: { role: "assistant", parts, raw: res.content },
    stop,
    note: stop === "other" ? `Unexpected stop reason: ${res.stop_reason}` : undefined,
  };
}

let client: Anthropic | undefined;

export const callAnthropic: CallModel = async (history) => {
  client ??= new Anthropic();
  const res = await client.beta.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    tools: TOOLS as Anthropic.Beta.BetaTool[],
    messages: toAnthropicMessages(history),
  });
  return fromAnthropicMessage(res as unknown as Parameters<typeof fromAnthropicMessage>[0]);
};
