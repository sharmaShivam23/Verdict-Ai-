import Link from "next/link";
import AgentChat from "./agent-chat";

export const metadata = { title: "Verdict agent" };

export default function AgentPage() {
  return (
    <main className="page">
      <header className="top">
        <div>
          <p className="eyebrow">Verdict · Agent</p>
          <h1>Experiment agent</h1>
          <p className="muted">
            Reads on its own. Asks before every change. Cannot override the Referee.
          </p>
        </div>
        <nav className="toggle" aria-label="Pages">
          <div className="group">
            <Link href="/">Dashboard</Link>
            <Link href="/agent" aria-current="page">
              Agent
            </Link>
          </div>
        </nav>
      </header>
      <AgentChat />
    </main>
  );
}
