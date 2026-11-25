import { toSnapshot } from "./flagsmith/adapter";
import type { FlagsmithExperimentDetail, FlagsmithResults } from "./flagsmith/adapter";
import a from "./flagsmith/fixtures/replay-a-84.json";
import b from "./flagsmith/fixtures/replay-b3-ship.json";
import c from "./flagsmith/fixtures/replay-c-srm.json";
import d from "./flagsmith/fixtures/replay-b2-96.json";
import type { ExperimentSnapshot } from "./types";

// Replay scenarios. They go through the exact same adapter, Referee and
// dashboard as live data.
//
//  A, B and D are REAL Flagsmith API responses captured on 2026-11-26 from
//    experiments 490, 493 and 492 (simulated traffic, identities sim-*).
//  C is CONSTRUCTED: Flagsmith's SRM field cannot be triggered in its Beta
//    (srm_p_value stayed null on a lopsided live split), so the payload is
//    hand-built in Flagsmith's raw shape and labelled constructed in the UI.
//
//  A: Flagsmith 82.8%         -> KEEP_RUNNING (below the 95% bar)
//  B: Flagsmith ~98%          -> SHIP (every check passes)
//  C: great-looking, 500/380  -> INVALID (traffic split broken)
//  D: Flagsmith 96.3%         -> KEEP_RUNNING (clears 95% but the interval still includes zero)

interface Fixture {
  _constructed?: boolean;
  detail: unknown;
  results: unknown;
}

function fromFixture(fx: Fixture): ExperimentSnapshot {
  const results = { results: fx.results } as FlagsmithResults;
  const asOf = results.results?.as_of;
  return toSnapshot(fx.detail as FlagsmithExperimentDetail, results, {
    synthetic: true,
    source: "replay",
    constructed: fx._constructed,
    // Fixed clock so a replay always renders the same "days running".
    now: asOf ? new Date(asOf) : new Date(0),
  });
}

export const REPLAY_SCENARIOS: Record<"A" | "B" | "C" | "D", ExperimentSnapshot> = {
  A: fromFixture(a as Fixture),
  B: fromFixture(b as Fixture),
  C: fromFixture(c as Fixture),
  D: fromFixture(d as Fixture),
};
