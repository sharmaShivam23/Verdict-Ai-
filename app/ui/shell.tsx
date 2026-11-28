import Link from "next/link";
import { Suspense } from "react";
import { describeConnection } from "@/lib/connection";
import { getCurrentUser } from "@/lib/auth/session";
import { getConnection } from "@/lib/connection-server";
import { IconLogo } from "./icons";
import NavLinks from "./nav-links";

async function ConnectionPill() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <Link href="/login" className="conn-pill" title="Sign in with GitHub">
        <i className="dot off" aria-hidden="true" />
        <div>
          <strong>Signed out</strong>
          <span>Sign in with GitHub to connect</span>
        </div>
      </Link>
    );
  }
  const c = describeConnection(await getConnection());
  return (
    <Link href="/connect" className="conn-pill" title="Manage connection">
      <i className={`dot ${c.flagsmith ? "on" : "off"}`} aria-hidden="true" />
      <div>
        <strong>{c.flagsmith ? `Project ${c.projectId ?? "connected"}` : "Not connected"}</strong>
        <span>
          {user.guest
            ? c.flagsmith
              ? "Guest session"
              : "Guest: add a project"
            : c.flagsmith
              ? `Signed in as ${user.login}`
              : `${user.login}: add a project`}
        </span>
      </div>
    </Link>
  );
}

async function SignOut() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <form action="/api/auth/logout" method="post" style={{ marginTop: 8 }}>
      <button type="submit" className="btn btn-ghost btn-sm" style={{ width: "100%" }}>
        {user.guest ? "Leave guest session" : "Sign out"}
      </button>
    </form>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Verdict home">
          <span className="brand-mark">
            <IconLogo size={20} />
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
          <Suspense fallback={null}>
            <SignOut />
          </Suspense>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
