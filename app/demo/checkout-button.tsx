"use client";

import { useFlagsmith } from "@flagsmith/flagsmith/react";
import { useState } from "react";
import { useDemo } from "./demo-provider";

// The experiment under test: which wording makes visitors click "checkout"?
// The label line below follows the one convention Verdict's cleanup step knows
// how to rewrite once an experiment has a winner.

export default function CheckoutButton() {
  const flagsmith = useFlagsmith();
  const { resetVisitor } = useDemo();
  const [clicked, setClicked] = useState(false);

  const label = "Buy now, free returns";

  function onClick() {
    // The conversion event the experiment's metric counts (occurrence).
    flagsmith.trackEvent("checkout_cta_click");
    setClicked(true);
  }

  return (
    <div className="card store-card">
      <p className="eyebrow">Study Planner Pro</p>
      <h2>One plan for the whole semester</h2>
      <p className="muted">Auto-schedules revision around your deadlines. $9 a month.</p>
      {clicked ? (
        <p role="status" className="chip live">
          Thanks. Your click was recorded as a conversion.
        </p>
      ) : (
        <button type="button" className="store-cta" onClick={onClick}>
          {label}
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={resetVisitor}>
        Try again as a new visitor
      </button>
    </div>
  );
}
