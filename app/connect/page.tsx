import { Suspense } from "react";
import { describeConnection } from "@/lib/connection";
import { getConnection } from "@/lib/connection-server";
import { IconLock } from "../ui/icons";
import { disconnectAction } from "./actions";
import ConnectForm from "./connect-form";

export const metadata = { title: "Connect" };

async function Body() {
  const c = describeConnection(await getConnection());
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Setup</p>
          <h1>Connect your project</h1>
          <p>
            Verdict works on YOUR Flagsmith project and YOUR code. Enter your own keys here and every page uses them. Someone else
            using this site sees only their own experiments.
          </p>
        </div>
        {c.source === "browser" && (
          <form action={disconnectAction}>
            <button className="btn btn-ghost" type="submit">
              Disconnect this browser
            </button>
          </form>
        )}
      </header>

      {c.source === "browser" ? (
        <div className="alert good" style={{ marginBottom: 18 }}>
          <IconLock />
          <div>
            <strong>This browser is connected</strong>
            <p className="muted">
              Flagsmith project {c.projectId} · key {c.flagsmithKey}
              {c.github ? ` · GitHub ${c.githubRepo}` : " · no GitHub repo"}
              {c.model ? " · Gemini key set" : " · no Gemini key"}. To change anything, fill the form again and save.
            </p>
          </div>
        </div>
      ) : (
        <div className="alert" style={{ marginBottom: 18 }}>
          <IconLock />
          <div>
            <strong>{c.flagsmith ? "Using the server's own keys" : "Nothing connected yet"}</strong>
            <p className="muted">
              {c.flagsmith
                ? "This copy of Verdict has keys in its .env.local, so everything works. Saving a connection here overrides them for this browser only."
                : "You can still explore the Replay results without connecting. Connect to run live experiments and the agent."}
            </p>
          </div>
        </div>
      )}

      <ConnectForm defaults={{ projectId: c.projectId ?? "", githubRepo: c.githubRepo ?? "", cleanupPath: c.cleanupPath }} />
    </>
  );
}

export default function ConnectPage() {
  return (
    <Suspense fallback={<p className="faint">Loading…</p>}>
      <Body />
    </Suspense>
  );
}
