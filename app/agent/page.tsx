import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import AgentChat from "./agent-chat";

export const metadata = { title: "Agent" };

async function Gate() {
  await requireUser();
  return <AgentChat />;
}

export default function AgentPage() {
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Experiment agent</h1>
          <p>It does the setup work in your Flagsmith project. It reads on its own, asks before every change, and can&apos;t overrule the referee.</p>
        </div>
      </header>
      <Suspense fallback={<p className="faint">Loading…</p>}>
        <Gate />
      </Suspense>
    </>
  );
}
