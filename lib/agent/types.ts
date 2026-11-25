// Provider-neutral conversation types. The loop, policy and tests use only
// these; Claude and Gemini adapters translate at the edge.

export type Part =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      id: string;
      /** Gemini needs the function name on the response. */
      name: string;
      payload: unknown;
      isError: boolean;
    };

export interface ChatMessage {
  role: "user" | "assistant";
  parts: Part[];
  /**
   * The provider's own content for an assistant turn (thinking blocks, thought
   * signatures). It is replayed unchanged so reasoning state is never lost.
   */
  raw?: unknown;
}

export type StopReason = "end" | "tool_use" | "refusal" | "max_tokens" | "other";

export interface ModelTurn {
  message: ChatMessage;
  stop: StopReason;
  /** Human-readable note for stop === "other" or "refusal". */
  note?: string;
}

export type CallModel = (history: ChatMessage[]) => Promise<ModelTurn>;
