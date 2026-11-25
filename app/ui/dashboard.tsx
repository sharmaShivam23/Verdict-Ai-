// Server components for the experiment health dashboard and the explainable
// verdict panel. No client JavaScript: the Live/Replay toggle is plain links.

import Link from "next/link";
import { auditWinProbability } from "@/lib/referee";
import { sampleRatioMismatch } from "@/lib/stats";
import type { Decision, ExperimentSnapshot, Verdict } from "@/lib/types";
import type { ExperimentListItem, Mode, ScenarioId } from "@/lib/load-snapshot";

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const signed = (x: number | undefined) =>
  x === undefined ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

const VERDICT_LABEL: Record<Verdict, string> = {
  SHIP: "SHIP",
  KEEP_RUNNING: "KEEP RUNNING",
  INCONCLUSIVE: "INCONCLUSIVE",
  INVALID: "INVALID",
};

const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: "A", label: "A: 83%, below the bar" },
  { id: "B", label: "B: clears every bar" },
  { id: "C", label: "C: split is broken (SRM)" },
  { id: "D", label: "D: Flagsmith says go, Verdict waits" },
];

export function ModeToggle({
  mode,
  scenario,
  experiments = [],
  experimentId,
}: {
  mode: Mode;
  scenario: ScenarioId;
  experiments?: ExperimentListItem[];
  /** The experiment currently shown in live mode. */
  experimentId?: string;
}) {
  return (
    <nav className="toggle" aria-label="Data source">
      <div className="group" role="group" aria-label="Page">
        <Link href="/" aria-current="page">
          Dashboard
        </Link>
        <Link href="/agent">Agent</Link>
        <Link href="/demo">Demo app</Link>
      </div>
      {mode === "live" && experiments.length > 0 && (
        <div className="group" role="group" aria-label="Experiment">
          {experiments.map((e) => (
            <Link
              key={e.id}
              href={`/?mode=live&experiment=${e.id}`}
              aria-current={String(e.id) === experimentId ? "page" : undefined}
            >
              #{e.id} {e.name}
            </Link>
          ))}
        </div>
      )}
      <div className="group" role="group" aria-label="Mode">
        <Link
          href={experimentId ? `/?mode=live&experiment=${experimentId}` : "/?mode=live"}
          aria-current={mode === "live" ? "page" : undefined}
        >
          Live
        </Link>
        <Link
          href={`/?mode=replay&scenario=${scenario}`}
          aria-current={mode === "replay" ? "page" : undefined}
        >
          Replay
        </Link>
      </div>
      {mode === "replay" && (
        <div className="group" role="group" aria-label="Replay scenario">
          {SCENARIOS.map((s) => (
            <Link
              key={s.id}
              href={`/?mode=replay&scenario=${s.id}`}
              aria-current={scenario === s.id ? "page" : undefined}
            >
              {s.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}

export function SourceBadges({ s }: { s: ExperimentSnapshot }) {
  return (
    <div className="badges">
      <span className={`badge ${s.source}`}>
        {s.source === "live" ? "LIVE DATA" : "REPLAY SCENARIO"}
      </span>
      {s.synthetic && <span className="badge sim">SIMULATED TRAFFIC</span>}
      {s.constructed && (
        <span className="badge constructed" title="Hand-built payload in Flagsmith's raw shape, not captured from Flagsmith">
          CONSTRUCTED PAYLOAD
        </span>
      )}
    </div>
  );
}

export function VerdictBanner({ d }: { d: Decision }) {
  return (
    <section className={`verdict v-${d.verdict}`} aria-labelledby="verdict-h">
      <p className="eyebrow">Verdict</p>
      <h2 id="verdict-h">
        {VERDICT_LABEL[d.verdict]}
        {d.winner && <span className="winner"> · winner: {d.winner}</span>}
      </h2>
      <p className="headline">{d.headline}</p>
      <p className="action">
        <strong>Recommended action:</strong> {d.recommendedAction}
      </p>
    </section>
  );
}

export function HealthPanel({ s }: { s: ExperimentSnapshot }) {
  const srm = sampleRatioMismatch(
    s.arms.map((a) => a.exposures),
    s.arms.map((a) => a.configuredShare),
  );
  const total = s.arms.reduce((a, b) => a + b.exposures, 0);
  const srmBad = srm.total >= 100 && srm.pValue < 0.001;
  const audit = auditWinProbability(s);

  return (
    <section aria-labelledby="health-h">
      <h2 id="health-h">Experiment health</h2>
      <div className="stats">
        <Stat label="Identities enrolled" value={total.toLocaleString()} />
        <Stat label="Days running" value={s.daysRunning < 1 ? "< 1" : String(s.daysRunning)} />
        <Stat
          label="SRM check"
          value={srmBad ? "FAILED" : "OK"}
          sub={`p = ${srm.pValue < 0.0001 ? "<0.0001" : srm.pValue.toFixed(4)}`}
          tone={srmBad ? "bad" : "good"}
        />
        <Stat
          label="Quarantined identities"
          value={String(s.quarantinedIdentities)}
        />
        <Stat
          label="Win-probability audit"
          value={audit.reproduced === undefined ? "Not audited" : audit.agrees ? "REPRODUCED" : "MISMATCH"}
          sub={
            audit.reproduced === undefined
              ? audit.skipReason
              : `Recomputed ${pct(audit.reproduced)} vs Flagsmith ${pct(audit.flagsmith ?? 0)}. Cross-check (Beta-Binomial, informational): ${pct(
                  audit.secondMethod ?? 0,
                )}`
          }
          tone={audit.reproduced === undefined ? undefined : audit.agrees ? "good" : "bad"}
        />
      </div>

      <table>
        <caption>
          Primary metric: <strong>{s.primaryMetric}</strong>
        </caption>
        <thead>
          <tr>
            <th scope="col">Variation</th>
            <th scope="col">Exposed</th>
            <th scope="col">Converted</th>
            <th scope="col">Rate</th>
            <th scope="col">Lift vs control</th>
            <th scope="col">95% interval</th>
            <th scope="col">Chance to beat control</th>
          </tr>
        </thead>
        <tbody>
          {s.arms.map((a) => (
            <tr key={a.name}>
              <th scope="row">
                {a.name}
                {a.isControl && <span className="tag">control</span>}
              </th>
              <td>{a.exposures.toLocaleString()}</td>
              <td>{a.conversions.toLocaleString()}</td>
              <td>{a.exposures > 0 ? pct(a.conversions / a.exposures) : "n/a"}</td>
              <td>{a.isControl ? "baseline" : signed(a.lift)}</td>
              <td>
                {a.isControl
                  ? "baseline"
                  : `${signed(a.ciLow)} to ${signed(a.ciHigh)}`}
              </td>
              <td>
                {a.isControl || a.winProbability === undefined
                  ? "n/a"
                  : pct(a.winProbability)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Guardrails</h3>
      {s.guardrails.length === 0 ? (
        <p className="muted">No guardrail metrics defined.</p>
      ) : (
        <ul className="plain">
          {s.guardrails.map((g) => (
            <li key={g.name}>
              {g.name}: {signed(g.delta)} ({signed(g.ciLow)} to {signed(g.ciHigh)}),{" "}
              {g.direction === "should_not_increase" ? "should not increase" : "should not decrease"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <p className="label">{label}</p>
      <p className="value">{value}</p>
      {sub && <p className="sub">{sub}</p>}
    </div>
  );
}

const STATUS_ICON = { pass: "PASS", fail: "FAIL", warn: "WARN" } as const;

export function ChecklistPanel({ d }: { d: Decision }) {
  return (
    <section aria-labelledby="why-h">
      <h2 id="why-h">Why this verdict</h2>
      <p className="muted">
        Every check below is computed by deterministic code. Nothing here is
        written by a language model.
      </p>
      <ul className="checks">
        {d.checks.map((c) => (
          <li key={c.id} className={`check ${c.status}`}>
            <span className="status">{STATUS_ICON[c.status]}</span>
            <div>
              <p className="check-label">{c.label}</p>
              <p className="check-detail">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <h3>Still uncertain</h3>
      <p className="muted">
        Even when every check passes, these assumptions are not ruled out.
      </p>
      <ul className="plain">
        {d.uncertainties.map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
    </section>
  );
}
