"use client";

import { useState } from "react";
import type { PublicSession } from "@/lib/agent/sessions";

const SUGGESTIONS = [
  "List my experiments.",
  "Is experiment 406 ready to ship?",
  "Design an A/B test for a new checkout button. Propose the plan before creating anything.",
];

export default function AgentChat() {
  const [session, setSession] = useState<PublicSession | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirms, setConfirms] = useState<Record<string, string>>({});

  async function call(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status}).`);
        return;
      }
      setSession(data as PublicSession);
      if ((data as PublicSession).status === "error" || (data as PublicSession).message) {
        setError((data as PublicSession).message ?? null);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    void call("/api/agent", { sessionId: session?.sessionId, message });
  }

  function decide(toolUseId: string, decision: "approve" | "deny") {
    if (!session || busy) return;
    void call("/api/agent/decide", {
      sessionId: session.sessionId,
      toolUseId,
      decision,
      confirm: confirms[toolUseId],
    });
  }

  const chat = (session?.log ?? []).filter((l) => l.kind === "user" || l.kind === "assistant");
  const activity = (session?.log ?? []).filter((l) => l.kind !== "user" && l.kind !== "assistant");
  const pending = session?.pending ?? [];

  return (
    <div className="agent">
      <div className="chat" aria-live="polite">
        {chat.length === 0 && (
          <div className="empty">
            <p className="muted">
              Ask Verdict about an experiment. Reading and analysis run on their
              own. Anything that changes Flagsmith stops here for your approval.
            </p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} className={`bubble ${m.kind}`}>
            <p className="who">{m.kind === "user" ? "You" : "Verdict"}</p>
            <p className="txt">{m.text}</p>
          </div>
        ))}
        {busy && <p className="muted">Working…</p>}
      </div>

      {pending.map((p) => (
        <section key={p.toolUseId} className={`approval ${p.risk}`} aria-label="Approval needed">
          <p className="eyebrow">
            {p.risk === "irreversible" ? "Approval needed · IRREVERSIBLE" : "Approval needed"}
          </p>
          <p className="summary">{p.summary}</p>
          <details>
            <summary>Exact tool call</summary>
            <pre>{JSON.stringify({ tool: p.name, input: p.input }, null, 2)}</pre>
          </details>
          {p.confirmPhrase && (
            <label className="confirm">
              Type <code>{p.confirmPhrase}</code> to confirm
              <input
                value={confirms[p.toolUseId] ?? ""}
                onChange={(e) => setConfirms({ ...confirms, [p.toolUseId]: e.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}
          <div className="buttons">
            <button type="button" className="approve" disabled={busy} onClick={() => decide(p.toolUseId, "approve")}>
              Approve
            </button>
            <button type="button" className="deny" disabled={busy} onClick={() => decide(p.toolUseId, "deny")}>
              Deny
            </button>
          </div>
        </section>
      ))}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label htmlFor="msg" className="sr-only">
          Message
        </label>
        <input
          id="msg"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={pending.length ? "Decide on the pending action first" : "Ask about an experiment…"}
          disabled={busy || pending.length > 0}
          autoComplete="off"
        />
        <button type="submit" disabled={busy || pending.length > 0 || !input.trim()}>
          Send
        </button>
      </form>

      {activity.length > 0 && (
        <section aria-labelledby="timeline-h" className="timeline">
          <h2 id="timeline-h">Decision timeline</h2>
          <ul className="plain">
            {activity.map((a, i) => (
              <li key={i}>
                <span className={`kind k-${a.kind}`}>{a.kind.replace("_", " ")}</span> {a.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
