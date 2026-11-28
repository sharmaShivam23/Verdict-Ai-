"use client";

import Link from "next/link";
import { useActionState } from "react";
import { IconAlert, IconCheck, IconClock, IconX } from "../ui/icons";
import { saveConnectionAction, testConnection, type CheckLine, type ConnectState } from "./actions";

const initial: ConnectState = {};

function CheckList({ checks }: { checks: CheckLine[] }) {
  return (
    <ul className="status-list">
      {checks.map((c) => (
        <li key={c.id} className={c.state === "ok" ? "ok" : c.state === "no" ? "no" : "wait"}>
          <span className="ic" aria-hidden="true">
            {c.state === "ok" ? <IconCheck size={13} /> : c.state === "no" ? <IconX size={13} /> : <IconClock size={13} />}
          </span>
          <div>
            <strong>{c.label}</strong>
            <small>{c.detail}</small>
          </div>
          <span className="faint" style={{ fontSize: 12, fontWeight: 650 }}>
            {c.state === "ok" ? "OK" : c.state === "no" ? "FAILED" : "NOTE"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface ConnectDefaults {
  id: string;
  label: string;
  projectId: string;
  environmentKey: string;
  githubRepo: string;
  cleanupPath: string;
  trafficIsReal: boolean;
  editing: boolean;
}

export default function ConnectForm({ defaults }: { defaults: ConnectDefaults }) {
  const keepHint = defaults.editing ? "Leave blank to keep the saved one." : "";
  const [tested, test, testing] = useActionState(testConnection, initial);
  const [saved, save, saving] = useActionState(saveConnectionAction, initial);
  const result = saved.checks || saved.error || saved.saved ? saved : tested;
  const busy = testing || saving;

  return (
    <form className="stack">
      <input type="hidden" name="id" value={defaults.id} />
      <section className="card">
        <div className="card-head">
          <div className="section-title">
            <span className="step-num">1</span>
            <div>
              <h2>Flagsmith</h2>
              <p>Needed for everything: reading results and setting up experiments.</p>
            </div>
          </div>
        </div>
        <div className="card-body form-grid">
          <div className="field full">
            <label htmlFor="label">Name</label>
            <input className="input" id="label" name="label" defaultValue={defaults.label} placeholder="e.g. LegalSetu website" maxLength={60} />
            <span className="hint">Only for you, to tell your projects apart.</span>
          </div>
          <div className="field full">
            <label htmlFor="flagsmithApiKey">Organisation API key</label>
            <input className="input mono" id="flagsmithApiKey" name="flagsmithApiKey" type="password" autoComplete="off" placeholder={defaults.editing ? "Saved. Leave blank to keep" : "Paste your key"} required={!defaults.editing} />
            <span className="hint">Flagsmith, then Organisation settings, then API Access, then Create API Key. Shown only once, so copy it then. {keepHint}</span>
          </div>
          <div className="field">
            <label htmlFor="environmentKey">Environment key</label>
            <input className="input mono" id="environmentKey" name="environmentKey" autoComplete="off" defaultValue={defaults.environmentKey} placeholder="e.g. kPxYj4HBBrw…" required />
            <span className="hint">Your project, then SDK Keys, then the client-side key. This one is public by design.</span>
          </div>
          <div className="field">
            <label htmlFor="projectId">Project id</label>
            <input className="input mono" id="projectId" name="projectId" inputMode="numeric" defaultValue={defaults.projectId} placeholder="e.g. 55600" required />
            <span className="hint">The number in your Flagsmith URL: /project/<b>55600</b>/…</span>
          </div>
          <div className="field">
            <label htmlFor="authScheme">Key type</label>
            <select className="select" id="authScheme" name="authScheme" defaultValue="Api-Key">
              <option value="Api-Key">Organisation API key</option>
              <option value="Token">Personal account token</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="section-title">
            <span className="step-num">2</span>
            <div>
              <h2>Your code on GitHub <span className="faint" style={{ fontWeight: 450 }}>· optional</span></h2>
              <p>After a winner ships, the cleanup pull request is opened in YOUR repo, not ours.</p>
            </div>
          </div>
        </div>
        <div className="card-body form-grid">
          <div className="field">
            <label htmlFor="githubRepo">Repository</label>
            <input className="input mono" id="githubRepo" name="githubRepo" defaultValue={defaults.githubRepo} placeholder="owner/name" />
          </div>
          <div className="field">
            <label htmlFor="cleanupPath">Code folder</label>
            <input className="input mono" id="cleanupPath" name="cleanupPath" defaultValue={defaults.cleanupPath} placeholder="src/components" />
            <span className="hint">The agent may only edit files in this folder.</span>
          </div>
          <div className="field full">
            <label htmlFor="githubToken">GitHub token</label>
            <input className="input mono" id="githubToken" name="githubToken" type="password" autoComplete="off" placeholder={defaults.editing ? "Saved if set. Leave blank to keep" : "github_pat_…"} />
            <span className="hint">A fine-grained token limited to that one repository, with Contents and Pull requests set to read and write.</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="section-title">
            <span className="step-num">3</span>
            <div>
              <h2>Agent model <span className="faint" style={{ fontWeight: 450 }}>· optional</span></h2>
              <p>Optional. Without your own key the agent uses this server&apos;s shared Gemini key. Gemini has a free tier if you want yours.</p>
            </div>
          </div>
        </div>
        <div className="card-body form-grid">
          <div className="field full">
            <label htmlFor="geminiApiKey">Gemini API key</label>
            <input className="input mono" id="geminiApiKey" name="geminiApiKey" type="password" autoComplete="off" placeholder={defaults.editing ? "Saved if set. Leave blank to keep" : "AIza…"} />
            <span className="hint">From aistudio.google.com. Used only for your own agent chats.</span>
          </div>
          <label className="row full" style={{ gap: 10 }}>
            <input type="checkbox" name="trafficIsReal" defaultChecked={defaults.trafficIsReal} />
            <span>
              My experiment traffic is <b>real visitors</b>
              <span className="hint" style={{ display: "block" }}>
                Leave this off for practice data. Verdict labels results as SIMULATED unless you tick this.
              </span>
            </span>
          </label>
        </div>
      </section>

      <div className="row">
        <button type="submit" className="btn" formAction={test} disabled={busy}>
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button type="submit" className="btn btn-primary" formAction={save} disabled={busy}>
          {saving ? "Saving…" : defaults.editing ? "Test and save changes" : "Test and save"}
        </button>
        <span className="faint" style={{ fontSize: 12.5 }}>
          Saved encrypted, under your GitHub account only.
        </span>
      </div>

      {result.error && (
        <div className="alert bad" role="alert">
          <IconAlert />
          <p>{result.error}</p>
        </div>
      )}
      {result.saved && (
        <div className="alert good" role="status">
          <IconCheck />
          <div>
            <strong>Saved</strong>
            <p className="muted">
              Saved to your account. Open <Link href="/" style={{ color: "var(--accent-strong)" }}>Experiments</Link> and choose Live.
              {defaults.editing ? " (The list above refreshes after you reload.)" : " It is your active project if it is your first one."}
            </p>
          </div>
        </div>
      )}
      {result.checks && (
        <section className="card" aria-label="Connection checks">
          <div className="card-head">
            <h2>What I checked</h2>
          </div>
          <CheckList checks={result.checks} />
        </section>
      )}
    </form>
  );
}
