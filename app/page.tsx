import { Suspense } from "react";
import { referee } from "@/lib/referee";
import {
  defaultExperimentId,
  listExperiments,
  loadSnapshot,
  parseExperiment,
  parseMode,
  parseScenario,
} from "@/lib/load-snapshot";
import {
  ChecklistPanel,
  HealthPanel,
  ModeToggle,
  SourceBadges,
  VerdictBanner,
} from "./ui/dashboard";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// With cacheComponents enabled, request-time data (searchParams, the Flagsmith
// fetch) must sit under <Suspense> so the static shell can prerender.
export default function Home({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="page">
      <Suspense fallback={<p className="muted">Loading experiment…</p>}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const mode = parseMode(sp.mode);
  const scenario = parseScenario(sp.scenario);
  const experimentId = parseExperiment(sp.experiment) ?? defaultExperimentId();
  const [{ snapshot, error }, experiments] = await Promise.all([
    loadSnapshot(mode, scenario, experimentId),
    mode === "live" ? listExperiments() : Promise.resolve([]),
  ]);
  const decision = snapshot ? referee(snapshot) : null;

  return (
    <>
      <header className="top">
        <div>
          <p className="eyebrow">Verdict · Toggle Wars, Track 02</p>
          <h1>{snapshot ? snapshot.name : "Experiment"}</h1>
          {snapshot && <p className="muted">{snapshot.hypothesis}</p>}
        </div>
        <ModeToggle
          mode={mode}
          scenario={scenario}
          experiments={experiments}
          experimentId={experimentId}
        />
      </header>

      {error && (
        <section className="notice" role="alert">
          <h2>Could not load live data</h2>
          <p>{error}</p>
          <p className="muted">
            Switch to Replay to see the Referee run on saved scenarios.
          </p>
        </section>
      )}

      {snapshot && decision && (
        <>
          <SourceBadges s={snapshot} />
          <VerdictBanner d={decision} />
          <div className="grid">
            <HealthPanel s={snapshot} />
            <ChecklistPanel d={decision} />
          </div>
        </>
      )}
    </>
  );
}
