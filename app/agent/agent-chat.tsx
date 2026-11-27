"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicSession } from "@/lib/agent/sessions";
import { IconAlert, IconBot, IconCheck, IconClock, IconLock, IconSend, IconShield, IconUser, IconX } from "../ui/icons";
import RichText from "../ui/rich-text";

const SUGGESTIONS = [
  "Which of my experiments are running?",
  "Is experiment 493 ready to ship?",
  "I want to test whether a white or a yellow theme gets more sign-ups. My current theme is black. Propose the plan first.",
];

const RULES: { title: string; body: string }[] = [
  { title: "Reads on its own", body: "Listing experiments and reading results never needs approval." },
  { title: "Asks before changing", body: "Every create, start, pause or pull request waits for you." },
  { title: "Can't overrule the referee", body: "Shipping a variation is refused unless the referee says SHIP." },
  { title: "Irreversible = typed phrase", body: "Completing an experiment needs you to type a confirmation." },
];

type Log = PublicSession["log"][number];

function ToolLine({ e }: { e: Log }) {
  const bad = e.kind === "error" || e.kind === "refused" || e.kind === "denied";
  const good = e.kind === "executed" || e.kind === "approved";
  return (
    <div className={`tool-line ${bad ? "bad" : good ? "good" : ""}`}>
      {bad ? <IconX size={13} /> : good ? <IconCheck size={13} /> : <IconClock size={13} />}
      <span>{e.kind.replace("_", " ")}</span>
      <code>{e.text}</code>
    </div>
  );
}

export default function AgentChat() {
  const [session, setSession] = useState<PublicSession | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirms, setConfirms] = useState<Record<string, string>>({});
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.log.length, session?.pending.length, busy]);

  async function call(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status}).`);
        return;
      }
      setSession(data as PublicSession);
      setError((data as PublicSession).message ?? null);
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
    void call("/api/agent/decide", { sessionId: session.sessionId, toolUseId, decision, confirm: confirms[toolUseId] });
  }

  const log = session?.log ?? [];
  const pending = session?.pending ?? [];
  const thread = log.filter((l) => l.kind !== "approval_requested" && l.kind !== "approved");
  const locked = busy || pending.length > 0;

  return (
    <div className="agent-layout">
      <section className="card chat" aria-label="Agent chat">
        <div className="chat-scroll" aria-live="polite">
          {thread.length === 0 && pending.length === 0 && (
            <div className="empty-chat">
              <span className="avatar" style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#338ced,#1b64be)", color: "#fff" }}>
                <IconBot size={22} />
              </span>
              <h2>What do you want to test?</h2>
              <p>
                Describe it in plain words. I set the experiment up in Flagsmith and read the results. I always ask before changing anything,
                and the referee, not me, decides when a result can be trusted.
              </p>
              <div className="suggestions" style={{ justifyContent: "center", marginTop: 8 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="suggestion" onClick={() => send(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {thread.map((e, i) =>
            e.kind === "user" || e.kind === "assistant" ? (
              <div key={i} className={`msg ${e.kind}`}>
                <span className="avatar">{e.kind === "user" ? <IconUser size={16} /> : <IconBot size={16} />}</span>
                <div>
                  <div className="msg-who">{e.kind === "user" ? "You" : "Verdict agent"}</div>
                  {e.kind === "assistant" ? <RichText text={e.text} /> : <div className="msg-text">{e.text}</div>}
                </div>
              </div>
            ) : (
              <ToolLine key={i} e={e} />
            ),
          )}

          {pending.map((p) => (
            <div key={p.toolUseId} className={`approval ${p.risk}`} role="group" aria-label="Approval needed">
              <div className="approval-head">
                {p.risk === "irreversible" ? <IconAlert size={14} /> : <IconShield size={14} />}
                {p.risk === "irreversible" ? "APPROVAL NEEDED · CANNOT BE UNDONE" : "APPROVAL NEEDED"}
              </div>
              <div className="approval-body">
                <p className="approval-summary">{p.summary}</p>
                <details>
                  <summary>See the exact action</summary>
                  <pre>{JSON.stringify({ tool: p.name, input: p.input }, null, 2)}</pre>
                </details>
                {p.confirmPhrase && (
                  <label className="typed">
                    <span>
                      Type <code>{p.confirmPhrase}</code> to confirm
                    </span>
                    <input
                      className="input mono"
                      value={confirms[p.toolUseId] ?? ""}
                      onChange={(e) => setConfirms({ ...confirms, [p.toolUseId]: e.target.value })}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                )}
                <div className="row">
                  <button type="button" className="btn btn-good" disabled={busy} onClick={() => decide(p.toolUseId, "approve")}>
                    <IconCheck size={15} /> Approve
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => decide(p.toolUseId, "deny")}>
                    Deny
                  </button>
                </div>
              </div>
            </div>
          ))}

          {busy && (
            <span className="typing" aria-label="Working">
              <i />
              <i />
              <i />
            </span>
          )}
          <div ref={end} />
        </div>

        {error && (
          <div className="alert bad" role="alert" style={{ margin: "0 16px 12px" }}>
            <IconAlert />
            <p>{error}</p>
          </div>
        )}

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <div className="composer-row">
            <label htmlFor="msg" className="sr-only">
              Message
            </label>
            <textarea
              id="msg"
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={pending.length ? "Approve or deny the action above first" : "Ask about an experiment, or describe a test to set up…"}
              disabled={locked}
            />
            <button type="submit" className="btn btn-primary" disabled={locked || !input.trim()} aria-label="Send">
              <IconSend size={16} />
              Send
            </button>
          </div>
          {thread.length > 0 && (
            <div className="suggestions">
              {SUGGESTIONS.slice(0, 2).map((s) => (
                <button key={s} type="button" className="suggestion" onClick={() => send(s)} disabled={locked}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </form>
      </section>

      <aside className="stack" aria-label="Safety rules and log">
        <section className="card">
          <div className="card-head">
            <div className="row" style={{ gap: 8 }}>
              <IconLock size={15} />
              <h2>How I&apos;m kept in check</h2>
            </div>
          </div>
          <ul className="rules">
            {RULES.map((r) => (
              <li key={r.title}>
                <IconCheck size={14} />
                <div>
                  <b>{r.title}</b>
                  {r.body}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Decision log</h2>
            <span className="faint num" style={{ fontSize: 12 }}>{log.filter((l) => l.kind !== "user" && l.kind !== "assistant").length} events</span>
          </div>
          {log.filter((l) => l.kind !== "user" && l.kind !== "assistant").length === 0 ? (
            <p className="faint" style={{ margin: 0, padding: "14px 18px 18px" }}>
              Every read, approval, denial and refusal is recorded here.
            </p>
          ) : (
            <ul className="timeline">
              {log
                .filter((l) => l.kind !== "user" && l.kind !== "assistant")
                .map((l, i) => (
                  <li key={i} className={`k-${l.kind}`}>
                    <i />
                    <span>
                      <em>{l.kind.replace("_", " ")}</em>
                      {l.text}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
