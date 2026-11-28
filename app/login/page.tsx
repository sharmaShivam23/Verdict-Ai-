import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { oauthConfigured } from "@/lib/auth/github";
import { getCurrentUser } from "@/lib/auth/session";
import { IconLock } from "../ui/icons";

export const metadata = { title: "Sign in" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const ERRORS: Record<string, string> = {
  not_configured: "Sign-in is not set up on this server yet (GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET are missing).",
  denied: "You cancelled the sign-in at GitHub.",
  state: "The sign-in could not be verified. Please try again.",
  failed: "Sign-in failed. Please try again. If you run Verdict yourself, check MONGODB_URI and your GitHub OAuth settings.",
};

async function Body({ searchParams }: { searchParams: SearchParams }) {
  if (await getCurrentUser()) redirect("/");
  const sp = await searchParams;
  const err = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const configured = oauthConfigured();

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Sign in</h1>
          <p>
            Sign in with GitHub to connect your own Flagsmith project and use the agent. There is no separate sign-up: your first
            sign-in creates your account. Verdict only reads your public GitHub profile.
          </p>
        </div>
      </header>

      {err && (
        <div className="alert bad" role="alert" style={{ marginBottom: 18 }}>
          <p>{err}</p>
        </div>
      )}

      <section className="card" style={{ maxWidth: 520 }}>
        <div className="card-body stack">
          <div className="row" style={{ gap: 10 }}>
            <IconLock />
            <span className="muted">Your keys are stored encrypted and tied to your account only.</span>
          </div>
          {/* A normal link: the route redirects to GitHub, so it must not be client-routed. */}
          <a className="btn btn-primary" href="/api/auth/github" aria-disabled={!configured}>
            Sign in with GitHub
          </a>
          <form action="/api/auth/guest" method="post">
            <button type="submit" className="btn" style={{ width: "100%" }}>
              Continue without login
            </button>
          </form>
          <p className="faint" style={{ fontSize: 12.5 }}>
            Guest mode has the full app: connect your own Flagsmith project, use the agent and integrate your site. Your keys are
            stored encrypted for one week in this browser only, never shared, and Verdict never uses anyone else&apos;s keys for you.
            Sign in with GitHub to keep your projects permanently.
          </p>
          <p className="faint" style={{ fontSize: 12.5 }}>
            Just looking? The <Link href="/?mode=replay&scenario=A" style={{ color: "var(--accent-strong)" }}>replay scenarios</Link> work without an account.
          </p>
        </div>
      </section>
    </>
  );
}

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="faint">Loading…</p>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
