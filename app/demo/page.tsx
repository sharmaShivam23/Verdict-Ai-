import Link from "next/link";
import CheckoutButton from "./checkout-button";
import { DemoProvider } from "./demo-provider";
import DemoStatus from "./demo-status";

export const metadata = { title: "Verdict demo app" };

export default function DemoPage() {
  return (
    <main className="page">
      <header className="top">
        <div>
          <p className="eyebrow">Verdict · Demo app under test</p>
          <h1>Checkout button experiment</h1>
          <p className="muted">
            A tiny storefront that Verdict experiments on. Each visit here sends a real
            exposure and, on click, a real conversion to Flagsmith. Traffic from the
            simulator uses <code>sim-</code> identities and is always labelled simulated.
          </p>
        </div>
        <nav className="toggle" aria-label="Pages">
          <div className="group">
            <Link href="/">Dashboard</Link>
            <Link href="/agent">Agent</Link>
            <Link href="/demo" aria-current="page">
              Demo app
            </Link>
          </div>
        </nav>
      </header>
      <DemoProvider>
        <div className="demo">
          <CheckoutButton />
          <DemoStatus />
        </div>
      </DemoProvider>
    </main>
  );
}
