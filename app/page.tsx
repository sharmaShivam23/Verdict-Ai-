import Link from "next/link";
import { Suspense } from "react";
import { getConnection } from "@/lib/connection-server";
import { isFlagsmithConnected } from "@/lib/flagsmith/client";
import {
  defaultExperimentId,
  listExperiments,
  loadSnapshot,
  parseExperiment,
  parseMode,
  parseScenario,
} from "@/lib/load-snapshot";
import { referee } from "@/lib/referee";
import { ChecksCard, NumbersCard, ScenarioTabs, SourceChips, UncertainCard, VerdictHero } from "./ui/dashboard";
import ExperimentSelect from "./ui/experiment-select";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// Request-time data (searchParams, cookies, the Flagsmith fetch) sits under
// <Suspense> so the static shell can prerender (cacheComponents is on).
export default function Home({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="faint">Loading experiment…</p>}>
      <Experiments searchParams={searchParams} />
    </Suspense>
  );
}

async function Experiments({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const mode = parseMode(sp.mode);
  const scenario = parseScenario(sp.scenario);
  const conn = await getConnection();
  const connected = isFlagsmithConnected(conn);

  // Live: the ?experiment= link, else the pinned one, else the first one.
  const experiments = mode === "live" ? await listExperiments(conn) : [];
  const experimentId =
    parseExperiment(sp.experiment) ?? defaultExperimentId(conn) ?? (experiments[0] ? String(experiments[0].id) : undefined);
  const { snapshot, error } = await loadSnapshot(mode, scenario, conn, experimentId);
  const decision = snapshot ? referee(snapshot) : null;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">{mode === "live" ? "Live from Flagsmith" : "Replay · saved results"}</p>
          <h1>{snapshot ? snapshot.name : "Experiments"}</h1>
          {snapshot && <p>{snapshot.hypothesis}</p>}
        </div>
        <div className="seg" role="group" aria-label="Data source">
          <Link href="/?mode=live" aria-current={mode === "live" ? "page" : undefined}>
            Live
          </Link>
          <Link href={`/?mode=replay&scenario=${scenario}`} aria-current={mode === "replay" ? "page" : undefined}>
            Replay
          </Link>
        </div>
      </header>

      {mode === "replay" && <ScenarioTabs active={scenario} />}

      {mode === "live" && experiments.length > 0 && (
        <div className="toolbar">
          <ExperimentSelect experiments={experiments} current={experimentId} />
        </div>
      )}

      {error && (
        <div className="alert warn" role="alert" style={{ marginBottom: 18 }}>
          <div>
            <strong>{connected ? "Couldn't load this experiment" : "Flagsmith isn't connected"}</strong>
            <p className="muted">{error}</p>
            <p className="faint" style={{ marginTop: 6 }}>
              {connected ? (
                <>Try another experiment, or switch to Replay.</>
              ) : (
                <>
                  <Link href="/connect" style={{ color: "var(--accent-strong)" }}>
                    Connect your Flagsmith project
                  </Link>{" "}
                  or look at the Replay results.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {snapshot && decision && (
        <div className="stack">
          <SourceChips s={snapshot} />
          <VerdictHero s={snapshot} d={decision} />
          <div className="grid-2">
            <NumbersCard s={snapshot} />
            <div className="stack">
              <ChecksCard d={decision} />
              <UncertainCard d={decision} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
