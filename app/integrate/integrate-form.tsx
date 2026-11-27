"use client";

import { useEffect, useMemo, useState } from "react";
import { htmlSnippet, reactSnippets, validateSnippetInput } from "@/lib/snippets";
import { IconCheck, IconClock, IconCopy } from "../ui/icons";
import { checkIntegration, type IntegrationStatus } from "./actions";

function CodeBox({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <pre className="code-block" aria-label={label}>
        <code>{code}</code>
      </pre>
      <button
        type="button"
        className="btn btn-sm copy-btn"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const ago = (iso: string | null) => {
  if (!iso) return null;
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  return `${Math.round(s / 3600)} hours ago`;
};

export default function IntegrateForm({ defaults }: { defaults: { environmentKey: string; connected: boolean } }) {
  const [envKey, setEnvKey] = useState(defaults.environmentKey);
  const [flag, setFlag] = useState("site_theme");
  const [event, setEvent] = useState("sign_up_click");
  const [versions, setVersions] = useState("white, yellow");
  const [tab, setTab] = useState<"html" | "react">("html");

  const parsed = useMemo(
    () => validateSnippetInput({ environmentKey: envKey.trim(), flag: flag.trim(), event: event.trim(), versions: versions.split(",") }),
    [envKey, flag, event, versions],
  );

  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  // The event count when watching began; later increases prove the website is reporting in.
  const [baseline, setBaseline] = useState<number | null>(null);
  const [watching, setWatching] = useState(false);

  async function poll(restart = false) {
    const s = await checkIntegration();
    setBaseline((b) => (restart || b === null ? s.total : b));
    setStatus(s);
  }

  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => void poll(), 4000);
    return () => clearInterval(t);
  }, [watching]);

  const gained = status && baseline !== null ? status.total - baseline : 0;
  const react = parsed.ok ? reactSnippets(parsed.value) : null;
  const exampleUrl = parsed.ok
    ? `/shop-example.html?env=${encodeURIComponent(parsed.value.environmentKey)}&flag=${encodeURIComponent(parsed.value.flag)}&event=${encodeURIComponent(parsed.value.event)}`
    : null;

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div className="section-title">
            <span className="step-num">1</span>
            <div>
              <h2>Describe your test</h2>
              <p>Four details. The code below updates as you type.</p>
            </div>
          </div>
        </div>
        <div className="card-body form-grid">
          <div className="field">
            <label htmlFor="env">Flagsmith environment key</label>
            <input className="input mono" id="env" value={envKey} onChange={(e) => setEnvKey(e.target.value)} placeholder="client-side key" />
            <span className="hint">{defaults.connected ? "Filled in from your connection. " : ""}Public by design, safe to put in a web page.</span>
          </div>
          <div className="field">
            <label htmlFor="flag">Flag name</label>
            <input className="input mono" id="flag" value={flag} onChange={(e) => setFlag(e.target.value)} />
            <span className="hint">What you will test, for example site_theme.</span>
          </div>
          <div className="field">
            <label htmlFor="versions">New versions to test</label>
            <input className="input mono" id="versions" value={versions} onChange={(e) => setVersions(e.target.value)} />
            <span className="hint">Comma separated. Your current version is the control automatically.</span>
          </div>
          <div className="field">
            <label htmlFor="event">Goal event</label>
            <input className="input mono" id="event" value={event} onChange={(e) => setEvent(e.target.value)} />
            <span className="hint">What counts as success, for example sign_up_click.</span>
          </div>
        </div>
        {!parsed.ok && (
          <p role="alert" style={{ margin: 0, padding: "0 20px 16px", color: "var(--warn)" }}>
            {parsed.error}
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="section-title">
            <span className="step-num">2</span>
            <div>
              <h2>Paste this into your website</h2>
              <p>It asks Flagsmith which version each visitor gets, and reports the goal when they do it.</p>
            </div>
          </div>
          <div className="seg" role="group" aria-label="Code type">
            <button type="button" aria-pressed={tab === "html"} onClick={() => setTab("html")}>
              Plain HTML
            </button>
            <button type="button" aria-pressed={tab === "react"} onClick={() => setTab("react")}>
              React / Next.js
            </button>
          </div>
        </div>
        <div className="card-body stack">
          {!parsed.ok ? (
            <p className="faint">Fix the details above to see your code.</p>
          ) : tab === "html" ? (
            <>
              <CodeBox code={htmlSnippet(parsed.value)} label="Plain HTML snippet" />
              <p className="faint" style={{ margin: 0 }}>
                Works on any website, even a single HTML file. No build step. Cleanup pull requests need the React version, because only that has code Verdict can safely remove.
              </p>
            </>
          ) : (
            react && (
              <>
                <div className="stack">
                  <p className="muted" style={{ margin: 0 }}><b>1.</b> Install</p>
                  <CodeBox code={react.install} label="Install command" />
                  <p className="muted" style={{ margin: 0 }}><b>2.</b> Wrap your app once (for example in your root layout)</p>
                  <CodeBox code={react.provider} label="Provider" />
                  <p className="muted" style={{ margin: 0 }}><b>3.</b> Use the version where you show the change</p>
                  <CodeBox code={react.usage} label="Usage" />
                  <p className="muted" style={{ margin: 0 }}><b>4.</b> Add this small helper</p>
                  <CodeBox code={react.helper} label="Helper" />
                </div>
                <p className="faint" style={{ margin: 0 }}>
                  Keep the <code>pick(useExperiment(…), {"{ … }"})</code> line exactly like this. It is the one shape Verdict can remove automatically in a pull request once a winner ships.
                </p>
              </>
            )
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="section-title">
            <span className="step-num">3</span>
            <div>
              <h2>Check that it works</h2>
              <p>Verdict watches Flagsmith&apos;s event counter. It only goes up when a real browser reports in.</p>
            </div>
          </div>
          <div className="row">
            {exampleUrl && (
              <a className="btn btn-sm" href={exampleUrl} target="_blank" rel="noreferrer">
                Open an example shop
              </a>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setWatching(true);
                void poll(true);
              }}
            >
              {watching ? "Watching…" : "Start watching"}
            </button>
          </div>
        </div>
        <ul className="status-list">
          {!status ? (
            <li className="wait">
              <span className="ic"><IconClock size={13} /></span>
              <div>
                <strong>Not started</strong>
                <small>Click Start watching, then open your page (or the example shop) and click your goal.</small>
              </div>
              <span />
            </li>
          ) : !status.connected ? (
            <li className="no">
              <span className="ic"><IconClock size={13} /></span>
              <div>
                <strong>Flagsmith isn&apos;t connected</strong>
                <small>Open Connect and add your keys first.</small>
              </div>
              <span />
            </li>
          ) : !status.enabled ? (
            <li className="no">
              <span className="ic"><IconClock size={13} /></span>
              <div>
                <strong>No event warehouse yet</strong>
                <small>{status.error ?? "In Flagsmith open Environment Settings, then Warehouse, and enable the Flagsmith warehouse."}</small>
              </div>
              <span />
            </li>
          ) : gained > 0 ? (
            <li className="ok">
              <span className="ic"><IconCheck size={13} /></span>
              <div>
                <strong>Connected. Flagsmith is receiving events from your website.</strong>
                <small>
                  {gained} new event{gained === 1 ? "" : "s"} since you started watching. Last one {ago(status.last)}.
                </small>
              </div>
              <span className="faint num" style={{ fontSize: 12 }}>{status.total.toLocaleString()} total</span>
            </li>
          ) : (
            <li className="wait">
              <span className="ic"><IconClock size={13} /></span>
              <div>
                <strong>Waiting for the first event…</strong>
                <small>
                  Flagsmith has {status.total.toLocaleString()} events so far{status.last ? `, the last ${ago(status.last)}` : ""}. Open your page and click the goal. It can take up to a minute to appear.
                </small>
              </div>
              <span />
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
