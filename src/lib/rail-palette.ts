/**
 * Colours for the allocation rail.
 *
 * Deliberately *not* per-token brand colours: a wallet holding eight tickers
 * would turn into a fruit salad. The rail is ranked — the biggest allocation
 * takes the deepest ink, the rest step through muted, low-chroma tones that sit
 * well next to each other — so the same mix always draws the same bar and the
 * eye reads proportion before it reads identity. Neighbouring ranks alternate
 * dark and light so thin slices stay distinguishable.
 */
const RAMP = [
  "#1f3a5f", // deep navy — the dominant allocation
  "#8fa3b8", // mist blue
  "#3e5c55", // deep teal
  "#b59a6a", // antique gold
  "#5a4a63", // plum
  "#a7b09a", // sage
  "#6b4f3f", // walnut
  "#c8c2b6", // stone
  "#2f3437", // graphite
  "#7d8fa6", // slate
];

export function railColor(rank: number): string {
  return RAMP[rank % RAMP.length];
}

/** Ranks by weight so the rail is stable regardless of array order. */
export function rankedByWeight<T extends { basisPoints: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.basisPoints - a.basisPoints);
}
