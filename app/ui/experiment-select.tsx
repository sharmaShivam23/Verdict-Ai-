"use client";

import { useRouter } from "next/navigation";
import type { ExperimentListItem } from "@/lib/load-snapshot";

export default function ExperimentSelect({
  experiments,
  current,
}: {
  experiments: ExperimentListItem[];
  current?: string;
}) {
  const router = useRouter();
  return (
    <label className="row" style={{ gap: 8 }}>
      <span className="faint" style={{ fontSize: 13 }}>
        Experiment
      </span>
      <select
        className="select"
        style={{ width: 300, height: 36 }}
        value={current ?? ""}
        onChange={(e) => router.push(`/?mode=live&experiment=${e.target.value}`)}
      >
        {experiments.map((e) => (
          <option key={e.id} value={String(e.id)}>
            #{e.id} · {e.name} ({e.status})
          </option>
        ))}
      </select>
    </label>
  );
}
