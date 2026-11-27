import CheckoutButton from "./checkout-button";
import { DemoProvider } from "./demo-provider";
import DemoStatus from "./demo-status";

export const metadata = { title: "Demo store" };

export default function DemoPage() {
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Setup</p>
          <h1>Demo store</h1>
          <p>
            A small store that Verdict runs experiments on. Every visit sends a real exposure and every click a real conversion to Flagsmith.
            Traffic from the simulator uses <code>sim-</code> names and is always labelled simulated.
          </p>
        </div>
      </header>
      <DemoProvider>
        <div className="store stack">
          <CheckoutButton />
          <DemoStatus />
        </div>
      </DemoProvider>
    </>
  );
}
