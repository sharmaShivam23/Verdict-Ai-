"use client";

// Two small charts, plain SVG. Colours: control is the neutral, variations take
// the categorical slots in fixed order (validated against the card surface).
// Identity is never colour alone: every bar and interval is directly labelled,
// and the table below the charts carries the same numbers.

import { useRef, useState } from "react";
import { armColor, type ArmDatum } from "./chart-colors";

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const signed = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%`;

type Tip = { x: number; y: number; title: string; rows: [string, string][] } | null;

function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: React.MouseEvent, title: string, rows: [string, string][]) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.min(e.clientX - box.left + 14, box.width - 190);
    setTip({ x, y: e.clientY - box.top + 14, title, rows });
  };
  const node = tip && (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      <b>{tip.title}</b>
      {tip.rows.map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
  return { ref, show, hide: () => setTip(null), node };
}

export function ConversionBars({ arms }: { arms: ArmDatum[] }) {
  const { ref, show, hide, node } = useTip();
  const W = 640;
  const L = 150; // label column
  const R = 120; // value column
  const rowH = 36;
  const barH = 12;
  const H = arms.length * rowH + 22;
  const rates = arms.map((a) => (a.exposures ? a.conversions / a.exposures : 0));
  const max = Math.max(0.05, ...rates) * 1.08;
  const x = (r: number) => L + (r / max) * (W - L - R);
  const ticks = [0, max / 2, max].map((t) => Math.round(t * 100) / 100);

  return (
    <div className="chart" ref={ref} onMouseLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Conversion rate by variation">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={x(t)} x2={x(t)} y1={0} y2={H - 18} />
            <text className="axis" x={x(t)} y={H - 4} textAnchor="middle">
              {pct(t, 0)}
            </text>
          </g>
        ))}
        {arms.map((a, i) => {
          const y = i * rowH + 8;
          const w = Math.max(2, x(rates[i]) - L);
          const rows: [string, string][] = [
            ["Visitors", a.exposures.toLocaleString()],
            ["Converted", a.conversions.toLocaleString()],
            ["Rate", pct(rates[i])],
          ];
          return (
            <g key={a.name}>
              <text className="label" x={0} y={y + barH - 1}>
                {a.isControl && a.name !== "control" ? `${a.name} (control)` : a.name}
              </text>
              {/* 4px rounded data end, square at the baseline */}
              <path
                d={`M${L},${y} h${w - 4} a4,4 0 0 1 4,4 v${barH - 8} a4,4 0 0 1 -4,4 h-${w - 4} z`}
                fill={armColor(arms, a)}
              />
              <text className="value" x={W - R + 12} y={y + barH - 1}>
                {pct(rates[i])}
                <tspan className="axis" dx={6}>
                  {a.conversions}/{a.exposures}
                </tspan>
              </text>
              <rect
                className="hit"
                x={0}
                y={y - 10}
                width={W}
                height={rowH}
                onMouseMove={(e) => show(e, a.isControl && a.name !== "control" ? `${a.name} (control)` : a.name, rows)}
              />
            </g>
          );
        })}
      </svg>
      {node}
    </div>
  );
}

export function LiftIntervals({ arms }: { arms: ArmDatum[] }) {
  const { ref, show, hide, node } = useTip();
  const treatments = arms.filter((a) => !a.isControl && a.ciLow !== undefined && a.ciHigh !== undefined);
  if (treatments.length === 0) {
    return <p className="chart faint">No interval reported yet.</p>;
  }
  const W = 640;
  const L = 150;
  const R = 185;
  const rowH = 40;
  const H = treatments.length * rowH + 26;
  const lo = Math.min(-0.1, ...treatments.map((t) => t.ciLow!)) * 1.1;
  const hi = Math.max(0.1, ...treatments.map((t) => t.ciHigh!)) * 1.1;
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const candidate = [lo, 0, hi].map((t) => Math.round(t * 20) / 20);
  // Only label values that have room: the zero line always, the ends only when 80px or more away from it.
  const ticks = candidate.filter((t) => t === 0 || Math.abs(x(t) - x(0)) >= 80);

  return (
    <div className="chart" ref={ref} onMouseLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Likely range of the lift for each variation">
        {ticks.map((t) => (
          <text key={t} className="axis" x={x(t)} y={H - 4} textAnchor="middle">
            {t === 0 ? "0 (no change)" : signed(t, 0)}
          </text>
        ))}
        <line className="zero" x1={x(0)} x2={x(0)} y1={0} y2={H - 18} />
        {treatments.map((t, i) => {
          const y = i * rowH + 18;
          const crosses = t.ciLow! <= 0 && t.ciHigh! >= 0;
          const tone = crosses ? "var(--warn)" : t.ciLow! > 0 ? "var(--good)" : "var(--bad)";
          const verdict = crosses ? "could be zero" : t.ciLow! > 0 ? "clearly better" : "clearly worse";
          return (
            <g key={t.name}>
              <text className="label" x={0} y={y + 4}>
                {t.name}
              </text>
              <line x1={x(t.ciLow!)} x2={x(t.ciHigh!)} y1={y} y2={y} stroke={tone} strokeWidth={2} strokeLinecap="round" />
              <line x1={x(t.ciLow!)} x2={x(t.ciLow!)} y1={y - 6} y2={y + 6} stroke={tone} strokeWidth={2} />
              <line x1={x(t.ciHigh!)} x2={x(t.ciHigh!)} y1={y - 6} y2={y + 6} stroke={tone} strokeWidth={2} />
              <circle cx={x(t.lift ?? 0)} cy={y} r={5} fill={tone} stroke="var(--surface)" strokeWidth={2} />
              <text className="value" x={W - R + 14} y={y + 4}>
                {signed(t.ciLow!, 0)} to {signed(t.ciHigh!, 0)}
                <tspan className="axis" dx={6}>
                  {verdict}
                </tspan>
              </text>
              <rect
                className="hit"
                x={0}
                y={y - 16}
                width={W}
                height={rowH}
                onMouseMove={(e) =>
                  show(e, t.name, [
                    ["Lift vs control", signed(t.lift ?? 0)],
                    ["95% range", `${signed(t.ciLow!)} to ${signed(t.ciHigh!)}`],
                    ["Chance to beat control", t.winProbability !== undefined ? pct(t.winProbability) : "n/a"],
                  ])
                }
              />
            </g>
          );
        })}
      </svg>
      {node}
    </div>
  );
}
