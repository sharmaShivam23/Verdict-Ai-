import Link from "next/link";
import { Suspense } from "react";
import { describeConnection } from "@/lib/connection";
import { getConnection } from "@/lib/connection-server";
import { IconLogo } from "./icons";
import NavLinks from "./nav-links";

async function ConnectionPill() {
  const c = describeConnection(await getConnection());
  return (
    <Link href="/connect" className="conn-pill" title="Manage connection">
      <i className={`dot ${c.flagsmith ? "on" : "off"}`} aria-hidden="true" />
      <div>
        <strong>{c.flagsmith ? `Project ${c.projectId ?? "connected"}` : "Not connected"}</strong>
        <span>
          {c.flagsmith
            ? c.source === "browser"
              ? "Your saved keys"
              : "Server keys (.env.local)"
            : "Replay only. Connect Flagsmith"}
        </span>
      </div>
    </Link>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Verdict home">
          <span className="brand-mark">
            <IconLogo />
          </span>
          <span>
            <span className="brand-name">Verdict</span>
            <span className="brand-sub">A/B test referee for Flagsmith</span>
          </span>
        </Link>
        <NavLinks />
        <div className="sidebar-foot">
          <Suspense fallback={<div className="conn-pill faint">Checking connection…</div>}>
            <ConnectionPill />
          </Suspense>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
