import { describe, expect, it } from "vitest";
import { TOOLS } from "../tools";
import type { ChatMessage } from "../types";
import { fromAnthropicMessage, toAnthropicMessages } from "./anthropic";
import { fromGeminiResponse, toGeminiContents, toGeminiTools } from "./gemini";

// ---------- Gemini ----------

describe("Gemini adapter", () => {
  const ids = () => {
    let n = 0;
    return () => `gm_${++n}`;
  };

  it("maps a function call, drops thought summaries, and keeps raw content for replay", () => {
    const content = {
      role: "model",
      parts: [
        { text: "thinking about it", thought: true },
        { text: "Let me check." },
        { functionCall: { name: "get_experiment_verdict", args: { experiment_id: 406 } }, thoughtSignature: "SIG" },
      ],
    };
    const turn = fromGeminiResponse({ candidates: [{ content, finishReason: "STOP" }] } as never, ids());
    expect(turn.stop).toBe("tool_use");
    expect(turn.message.parts).toEqual([
      { type: "text", text: "Let me check." },
      { type: "tool_call", id: "gm_1", name: "get_experiment_verdict", input: { experiment_id: 406 } },
    ]);
    expect(turn.message.raw).toBe(content); // thoughtSignature survives untouched
  });

  it("uses Gemini's own function call id when present", () => {
    const turn = fromGeminiResponse({
      candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "abc", name: "list_experiments", args: {} } }] } }],
    } as never);
    expect(turn.message.parts[0]).toMatchObject({ type: "tool_call", id: "abc" });
  });

  it("replays raw model content unchanged and sends function responses with output/error keys", () => {
    const raw = { role: "model", parts: [{ functionCall: { name: "a", args: {} }, thoughtSignature: "SIG" }] };
    const history: ChatMessage[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      { role: "assistant", parts: [{ type: "tool_call", id: "gm_1", name: "a", input: {} }], raw },
      {
        role: "user",
        parts: [
          { type: "tool_result", id: "gm_1", name: "a", payload: { ok: true }, isError: false },
          { type: "tool_result", id: "real-2", name: "b", payload: { denied: true }, isError: true },
        ],
      },
    ];
    const out = toGeminiContents(history);
    expect(out[0]).toEqual({ role: "user", parts: [{ text: "hi" }] });
    expect(out[1]).toBe(raw);
    expect(out[2].role).toBe("user");
    // Synthetic ids are NOT echoed back; real ids are. Order is preserved.
    expect(out[2].parts).toEqual([
      { functionResponse: { name: "a", response: { output: { ok: true } } } },
      { functionResponse: { id: "real-2", name: "b", response: { error: { denied: true } } } },
    ]);
  });

  it("rebuilds assistant tool calls without a raw copy, omitting synthetic ids", () => {
    const out = toGeminiContents([
      { role: "assistant", parts: [{ type: "tool_call", id: "gm_9", name: "x", input: { a: 1 } }] },
    ]);
    expect(out[0]).toEqual({ role: "model", parts: [{ functionCall: { name: "x", args: { a: 1 } } }] });
  });

  it("maps finish reasons", () => {
    const mk = (finishReason: string) =>
      fromGeminiResponse({ candidates: [{ content: { role: "model", parts: [{ text: "x" }] }, finishReason }] } as never);
    expect(mk("STOP").stop).toBe("end");
    expect(mk("MAX_TOKENS").stop).toBe("max_tokens");
    expect(mk("SAFETY").stop).toBe("refusal");
    expect(mk("MALFORMED_FUNCTION_CALL").stop).toBe("other");
  });

  it("treats a blocked prompt (no candidates) as a refusal with a reason", () => {
    const turn = fromGeminiResponse({ candidates: [], promptFeedback: { blockReason: "SAFETY" } } as never);
    expect(turn.stop).toBe("refusal");
    expect(turn.note).toMatch(/SAFETY/);
  });

  it("declares every tool with JSON-schema parameters", () => {
    const decls = toGeminiTools()[0].functionDeclarations;
    expect(decls.map((d) => d.name)).toEqual(TOOLS.map((t) => t.name));
    for (const d of decls) expect((d.parametersJsonSchema as { type: string }).type).toBe("object");
  });
});

// ---------- Claude ----------

describe("Claude adapter", () => {
  it("maps tool_use blocks and keeps raw content (thinking blocks) for replay", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "text", text: "ok" },
      { type: "tool_use", id: "t1", name: "list_experiments", input: {} },
    ];
    const turn = fromAnthropicMessage({ stop_reason: "tool_use", content });
    expect(turn.stop).toBe("tool_use");
    expect(turn.message.parts).toEqual([
      { type: "text", text: "ok" },
      { type: "tool_call", id: "t1", name: "list_experiments", input: {} },
    ]);
    expect(turn.message.raw).toBe(content);
  });

  it("sends all tool results in one user message with is_error set", () => {
    const out = toAnthropicMessages([
      {
        role: "user",
        parts: [
          { type: "tool_result", id: "a", name: "x", payload: { ok: 1 }, isError: false },
          { type: "tool_result", id: "b", name: "y", payload: { denied: true }, isError: true },
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toEqual([
      { type: "tool_result", tool_use_id: "a", content: '{"ok":1}', is_error: false },
      { type: "tool_result", tool_use_id: "b", content: '{"denied":true}', is_error: true },
    ]);
  });

  it("maps stop reasons", () => {
    const mk = (r: string) => fromAnthropicMessage({ stop_reason: r, content: [] }).stop;
    expect(mk("end_turn")).toBe("end");
    expect(mk("max_tokens")).toBe("max_tokens");
    expect(mk("refusal")).toBe("refusal");
    expect(mk("weird")).toBe("other");
  });
});
