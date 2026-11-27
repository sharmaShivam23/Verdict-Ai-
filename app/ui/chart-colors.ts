// Shared by server and client components, so it must NOT be a "use client" file.
// Control is the neutral; variations take the categorical slots in fixed order
// (the four colours were validated against the card surface with the dataviz checker).

export interface ArmDatum {
  name: string;
  isControl: boolean;
  exposures: number;
  conversions: number;
  lift?: number;
  ciLow?: number;
  ciHigh?: number;
  winProbability?: number;
}

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

export const armColor = (arms: ArmDatum[], a: ArmDatum): string =>
  a.isControl ? "var(--series-control)" : SERIES[arms.filter((x) => !x.isControl).indexOf(a) % SERIES.length];
