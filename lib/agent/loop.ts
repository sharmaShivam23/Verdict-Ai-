// The agent loop. Manual loop (not an SDK tool runner) because it must PAUSE
// mid-turn for human approval and resume later, across HTTP requests.
//
// Both providers require every tool call in an assistant turn to be answered
// together in ONE following user message, so results for read tools are held
// until the human has decided on every write tool.

import { confirmPhrase, describeAction, riskOf } from "./policy";
import { ToolInputError } from "./tools";
import type { CallModel, ChatMessage, Part } from "./types";

const MAX_STEPS = 10;
const MAX_RESULT_CHARS = 8000;

type ToolResultPart = Extract<Part, { type: "tool_result" }>;

export interface PendingApproval {
  toolUseId: string;
  name: string;
  input: unknown;
  risk: "write" | "irreversible";
  summary: string;
  /** Only for irreversible actions: the phrase the human must type. */
  confirmPhrase?: string;
}

export interface LogEntry {
  at: string;
  kind:
    | "user"
    | "assistant"
    | "read"
    | "approval_requested"
    | "approved"
    | "denied"
    | "executed"
    | "refused"
    | "error";
  text: string;
}

export interface AgentSession {
  id: string;
  /** Neutral history. Never sent to the browser (raw may hold reasoning state). */
  messages: ChatMessage[];
  /** tool call ids of the current assistant turn, in order. */
  expectedIds: string[];
  results: Record<string, ToolResultPart>;
  pending: PendingApproval[];
  log: LogEntry[];
}

export interface AgentDeps {
  callModel: CallModel;
  execute: (name: string, input: unknown) => Promise<unknown>;
  now?: () => Date;
}

export interface TurnResult {
  status: "done" | "awaiting_approval" | "error";
  /** Message for the UI when status is error or the approval was rejected. */
  message?: string;
}

export function newSession(id: string): AgentSession {
  return { id, messages: [], expectedIds: [], results: {}, pending: [], log: [] };
}

function note(s: AgentSession, deps: AgentDeps, kind: LogEntry["kind"], text: string) {
  s.log.push({ at: (deps.now?.() ?? new Date()).toISOString(), kind, text });
}

/** Keeps tool payloads bounded so one huge result cannot blow the context. */
function bound(payload: unknown): unknown {
  const t = typeof payload === "string" ? payload : JSON.stringify(payload);
  return t.length > MAX_RESULT_CHARS ? `${t.slice(0, MAX_RESULT_CHARS)}... [truncated]` : payload;
}

function result(id: string, name: string, payload: unknown, isError = false): ToolResultPart {
  return { type: "tool_result", id, name, payload: bound(payload), isError };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

async function runTool(
  s: AgentSession,
  deps: AgentDeps,
  id: string,
  name: string,
  input: unknown,
  logKind: "read" | "executed",
) {
  try {
    const out = await deps.execute(name, input);
    const refused = typeof out === "object" && out !== null && (out as { refused?: boolean }).refused;
    note(s, deps, refused ? "refused" : logKind, `${name}: ${refused ? (out as { reason: string }).reason : "ok"}`);
    s.results[id] = result(id, name, out, Boolean(refused));
  } catch (e) {
    note(s, deps, "error", `${name}: ${errText(e)}`);
    // Input errors are the model's to fix; everything else is reported as-is.
    s.results[id] = result(id, name, { error: errText(e), retryable: e instanceof ToolInputError }, true);
  }
}

/** Runs the model until it finishes or needs a human decision. */
async function advance(s: AgentSession, deps: AgentDeps): Promise<TurnResult> {
  for (let step = 0; step < MAX_STEPS; step++) {
    let turn;
    try {
      turn = await deps.callModel(s.messages);
    } catch (e) {
      note(s, deps, "error", `model: ${errText(e)}`);
      return { status: "error", message: errText(e) };
    }

    // Keep the provider's raw content (thinking / signatures) for replay.
    s.messages.push(turn.message);

    for (const p of turn.message.parts) {
      if (p.type === "text" && p.text.trim()) note(s, deps, "assistant", p.text);
    }

    if (turn.stop === "refusal") {
      return { status: "error", message: turn.note ?? "The model declined this request." };
    }
    if (turn.stop === "max_tokens") {
      return { status: "error", message: "The response was cut off (max tokens). Try a shorter request." };
    }
    if (turn.stop === "other") {
      return { status: "error", message: turn.note ?? "The model stopped unexpectedly." };
    }

    const calls = turn.message.parts.filter(
      (p): p is Extract<Part, { type: "tool_call" }> => p.type === "tool_call",
    );
    if (turn.stop !== "tool_use" || calls.length === 0) return { status: "done" };

    s.expectedIds = calls.map((c) => c.id);
    s.results = {};
    s.pending = [];

    for (const c of calls) {
      const risk = riskOf(c.name);
      if (!risk) {
        s.results[c.id] = result(c.id, c.name, { error: `Unknown tool "${c.name}".` }, true);
        note(s, deps, "error", `Unknown tool requested: ${c.name}`);
      } else if (risk === "read") {
        await runTool(s, deps, c.id, c.name, c.input, "read");
      } else {
        const p: PendingApproval = {
          toolUseId: c.id,
          name: c.name,
          input: c.input,
          risk,
          summary: describeAction(c.name, c.input),
          confirmPhrase: confirmPhrase(c.name, c.input),
        };
        s.pending.push(p);
        note(s, deps, "approval_requested", p.summary);
      }
    }

    if (s.pending.length > 0) return { status: "awaiting_approval" };
    flushResults(s);
  }
  return { status: "error", message: "Stopped after too many steps without finishing." };
}

/** Sends all collected tool results as ONE user message, in call order. */
function flushResults(s: AgentSession) {
  s.messages.push({ role: "user", parts: s.expectedIds.map((id) => s.results[id]) });
  s.expectedIds = [];
  s.results = {};
}

export async function sendUserMessage(
  s: AgentSession,
  text: string,
  deps: AgentDeps,
): Promise<TurnResult> {
  if (s.pending.length > 0) {
    return { status: "awaiting_approval", message: "Approve or deny the pending action first." };
  }
  note(s, deps, "user", text);
  s.messages.push({ role: "user", parts: [{ type: "text", text }] });
  return advance(s, deps);
}

export async function decide(
  s: AgentSession,
  toolUseId: string,
  decision: "approve" | "deny",
  typedConfirmation: string | undefined,
  deps: AgentDeps,
): Promise<TurnResult> {
  const p = s.pending.find((x) => x.toolUseId === toolUseId);
  if (!p) return { status: "error", message: "No such pending action." };

  if (decision === "deny") {
    s.results[toolUseId] = result(
      toolUseId,
      p.name,
      { denied: true, note: "The human denied this action. Do not retry it; ask what they want instead." },
      true,
    );
    note(s, deps, "denied", p.summary);
  } else {
    // Enforced here on the server; the UI input is only a convenience.
    if (p.confirmPhrase && typedConfirmation?.trim() !== p.confirmPhrase) {
      return {
        status: "awaiting_approval",
        message: `Type exactly "${p.confirmPhrase}" to confirm this irreversible action.`,
      };
    }
    note(s, deps, "approved", p.summary);
    await runTool(s, deps, toolUseId, p.name, p.input, "executed");
  }

  s.pending = s.pending.filter((x) => x.toolUseId !== toolUseId);
  if (s.pending.length > 0) return { status: "awaiting_approval" };
  flushResults(s);
  return advance(s, deps);
}
