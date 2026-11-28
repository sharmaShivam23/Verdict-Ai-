// Small inline icon set (no dependency). 16px, stroke = currentColor.

type P = { size?: number; className?: string };

function Svg({ size = 16, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const IconGauge = (p: P) => (
  <Svg {...p}>
    <path d="M12 14l4-4" />
    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
  </Svg>
);
export const IconBot = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 8V4" />
    <circle cx="12" cy="3" r="1" />
    <path d="M9 14h.01M15 14h.01" />
  </Svg>
);
export const IconPlug = (p: P) => (
  <Svg {...p}>
    <path d="M9 2v6M15 2v6" />
    <path d="M6 8h12v4a6 6 0 0 1-12 0z" />
    <path d="M12 18v4" />
  </Svg>
);
export const IconCode = (p: P) => (
  <Svg {...p}>
    <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
  </Svg>
);
export const IconStore = (p: P) => (
  <Svg {...p}>
    <path d="M3 9l1.5-5h15L21 9" />
    <path d="M4 9v11h16V9" />
    <path d="M9 20v-6h6v6" />
  </Svg>
);
export const IconUser = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Svg>
);
export const IconX = (p: P) => (
  <Svg {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const IconBan = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </Svg>
);
export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </Svg>
);
export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Svg>
);
export const IconGit = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="2" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="12" r="2" />
    <path d="M6 8v8M8 6h4a4 4 0 0 1 4 4v0" />
  </Svg>
);
export const IconSend = (p: P) => (
  <Svg {...p}>
    <path d="M22 2L11 13" />
    <path d="M22 2l-7 20-4-9-9-4z" />
  </Svg>
);
export const IconBook = (p: P) => (
  <Svg {...p}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
    <path d="M4 19.5V21h16" />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Svg>
);
export const IconRefresh = (p: P) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </Svg>
);
export const IconLogo = ({ size = 16 }: P) => (
  // Verdict mark: a "V" whose arms are the two arms of an A/B test.
  // Left arm = control (muted, hollow end), right arm = winning variant (bold, solid end).
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 7.5L11 18" stroke="#fff" strokeOpacity={0.55} strokeWidth={2.2} strokeLinecap="round" />
    <path d="M11 18L19 5.5" stroke="#fff" strokeWidth={2.8} strokeLinecap="round" />
    <circle cx="5.2" cy="5.2" r="2" stroke="#fff" strokeOpacity={0.7} strokeWidth={1.6} />
    <circle cx="19.6" cy="4.6" r="2.1" fill="#fff" />
  </svg>
);

/** Icon for a verdict. Colour never carries meaning alone: label + icon always. */
export function VerdictIcon({ verdict, size = 16 }: { verdict: string; size?: number }) {
  if (verdict === "SHIP") return <IconCheck size={size} />;
  if (verdict === "KEEP_RUNNING") return <IconClock size={size} />;
  if (verdict === "INVALID") return <IconBan size={size} />;
  return <IconAlert size={size} />;
}
