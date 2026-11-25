"use client";

import { useFlags, useFlagsmithLoading } from "@flagsmith/flagsmith/react";
import { useDemo } from "./demo-provider";

/** Read-only panel showing what this visitor was served (for debugging and demos). */
export default function DemoStatus() {
  const { visitorId } = useDemo();
  const loading = useFlagsmithLoading();
  // useFlags reads without recording an exposure; only the button does that.
  const { checkout_cta_test: flag } = useFlags(["checkout_cta_test"]);

  return (
    <dl className="demo-status" aria-label="What this visitor was served">
      <div>
        <dt>Visitor</dt>
        <dd>{visitorId.slice(0, 12)}…</dd>
      </div>
      <div>
        <dt>Flag value</dt>
        <dd>{loading?.isLoading ? "loading…" : String(flag?.value ?? "none")}</dd>
      </div>
      <div>
        <dt>Traffic</dt>
        <dd>real browser visit (not simulated)</dd>
      </div>
    </dl>
  );
}
