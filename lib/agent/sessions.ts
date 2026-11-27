// In-memory session store. Fine for a single local process (the hackathon
// demo). It survives dev hot reloads via globalThis, and is lost on restart.

import { newSession, type AgentSession, type LogEntry, type PendingApproval, type TurnResult } from "./loop";

const g = globalThis as unknown as { __verdictSessions?: Map<string, AgentSession> };
const store = (g.__verdictSessions ??= new Map<string, AgentSession>());

// Each session is locked to the connection that started it, so one person can
// never continue (or approve actions in) a session that acts on someone else's keys.
const owners = ((globalThis as unknown as { __verdictOwners?: Map<string, string> }).__verdictOwners ??= new Map());

export function getOrCreateSession(id: string | undefined, owner: string): AgentSession {
  if (id) {
    const existing = store.get(id);
    if (existing && owners.get(id) === owner) return existing;
  }
  const s = newSession(crypto.randomUUID());
  store.set(s.id, s);
  owners.set(s.id, owner);
  return s;
}

export function getSession(id: string, owner: string): AgentSession | undefined {
  return owners.get(id) === owner ? store.get(id) : undefined;
}

/** What the browser is allowed to see: never the raw API history. */
export interface PublicSession {
  sessionId: string;
  status: TurnResult["status"];
  message?: string;
  pending: PendingApproval[];
  log: LogEntry[];
}

export function toPublic(s: AgentSession, r: TurnResult): PublicSession {
  return {
    sessionId: s.id,
    status: r.status,
    message: r.message,
    pending: s.pending,
    log: s.log,
  };
}
