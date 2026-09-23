/**
 * Colours for the allocation rail.
 *
 * Deliberately *not* per-token brand colours: a wallet holding eight tickers
 * would turn into a fruit salad and the one accent would stop meaning anything.
 * The rail is ranked — the biggest allocation carries the seal, the rest step
 * down through ink tints — so the same mix always draws the same bar and
 * the eye reads proportion before it reads identity.
 */
const RAMP = [
  "#ec4e7c", // seal — the dominant allocation
  "#171216",
  "#5b5158",
  "#b8325a",
  "#9a8f95",
  "#7d2044",
  "#c9c0c4",
  "#f2879f",
  "#e2d9dd",
  "#3f3f3f",
];

export function railColor(rank: number): string {
  return RAMP[rank % RAMP.length];
}

/** Ranks by weight so the rail is stable regardless of array order. */
export function rankedByWeight<T extends { basisPoints: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.basisPoints - a.basisPoints);
}
