import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { mongoStore } from "@/lib/connections-store";
import { IconLock } from "../ui/icons";
import { activateAction, deleteAction } from "./actions";
import ConnectForm from "./connect-form";

export const metadata = { title: "Connect" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

async function Body({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const editParam = typeof sp.edit === "string" ? sp.edit : undefined;

  let connections: Awaited<ReturnType<typeof mongoStore.listConnections>> = [];
  let dbError: string | undefined;
  try {
    connections = await mongoStore.listConnections(user.id);
  } catch (e) {
    console.error("connect page: database error:", e instanceof Error ? e.message : e);
    dbError = "Could not reach the database. Check MONGODB_URI and that your IP is allowed in MongoDB Atlas.";
  }
  const editing = editParam ? connections.find((c) => c.id === editParam) : undefined;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Setup</p>
          <h1>Your projects</h1>
          <p>
            Verdict works on YOUR Flagsmith project and YOUR code.{" "}
            {user.guest
              ? "You are using a guest session: your projects are stored encrypted for one week, in this browser only. Sign in with GitHub to keep them."
              : `Each project you save here belongs to your GitHub account (${user.login}) and is stored encrypted.`}{" "}
            Nobody else can see or use it.
          </p>
        </div>
      </header>

      {dbError && (
        <div className="alert bad" role="alert" style={{ marginBottom: 18 }}>
          <p>{dbError}</p>
        </div>
      )}

      {connections.length === 0 && !dbError ? (
        <div className="alert" style={{ marginBottom: 18 }}>
          <IconLock />
          <div>
            <strong>No project saved yet</strong>
            <p className="muted">Add your first one below. You can still explore the Replay results without one.</p>
          </div>
        </div>
      ) : (
        <div className="stack" style={{ marginBottom: 18 }}>
          {connections.map((c) => {
            const active = user.activeConnectionId === c.id;
            return (
              <section className="card" key={c.id} aria-label={`Saved project ${c.label}`}>
                <div className="card-head">
                  <div>
                    <h2>
                      {c.label} {active && <span className="chip live" style={{ marginLeft: 8 }}>ACTIVE</span>}
                    </h2>
                    <p>
                      Flagsmith project {c.summary.projectId} · key {c.summary.flagsmithKeyMask}
                      {c.summary.hasGithub ? ` · GitHub ${c.summary.githubRepo} (${c.summary.cleanupPath})` : " · no GitHub repo"}
                      {c.summary.hasGemini ? " · Gemini key set" : " · no Gemini key"}
                      {c.summary.trafficIsReal ? " · real visitors" : " · traffic labelled SIMULATED"}
                    </p>
                  </div>
                  <div className="row">
                    {!active && (
                      <form action={activateAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn btn-sm" type="submit">Make active</button>
                      </form>
                    )}
                    <a className="btn btn-sm" href={`/connect?edit=${encodeURIComponent(c.id)}`}>Edit</a>
                    <form action={deleteAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className="btn btn-ghost btn-sm" type="submit">Delete</button>
                    </form>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <h2 style={{ margin: "8px 0 12px" }}>{editing ? `Edit “${editing.label}”` : "Add a project"}</h2>
      <ConnectForm
        key={editing?.id ?? "new"}
        defaults={{
          id: editing?.id ?? "",
          label: editing?.label ?? "",
          projectId: editing?.summary.projectId ?? "",
          environmentKey: editing?.summary.environmentKey ?? "",
          githubRepo: editing?.summary.githubRepo ?? "",
          cleanupPath: editing?.summary.cleanupPath ?? "app/",
          trafficIsReal: editing?.summary.trafficIsReal ?? false,
          editing: Boolean(editing),
        }}
      />
    </>
  );
}

export default function ConnectPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="faint">Loading…</p>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
