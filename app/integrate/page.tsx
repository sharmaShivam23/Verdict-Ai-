import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { getConnection } from "@/lib/connection-server";
import IntegrateForm from "./integrate-form";

export const metadata = { title: "Integrate a website" };

async function Body() {
  await requireUser();
  const c = await getConnection();
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Setup</p>
          <h1>Connect your website to a test</h1>
          <p>
            Flagsmith can only count what your website tells it. Paste the code below into your site, and every visitor is split between your
            versions and their goal is counted. No fake data.
          </p>
        </div>
      </header>
      <IntegrateForm defaults={{ environmentKey: c.environmentKey ?? "", connected: Boolean(c.environmentKey) }} />
    </>
  );
}

export default function IntegratePage() {
  return (
    <Suspense fallback={<p className="faint">Loading…</p>}>
      <Body />
    </Suspense>
  );
}
