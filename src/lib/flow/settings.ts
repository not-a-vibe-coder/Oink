import { baseAmount } from "./amounts";
import type { FlowWeight } from "./types";
export const FLOW_SYMBOLS = ["SPYx", "AAPLx", "NVDAx"] as const;
export function validateFlowSettings(
  target: unknown,
  weights: unknown,
): { cashTargetBase: string; weights: FlowWeight[] } {
  const cashTargetBase = baseAmount(target).toString();
  if (!Array.isArray(weights) || weights.length > 3)
    throw new Error("Choose at most three investment assets.");
  const seen = new Set<string>();
  let total = 0;
  const result = weights.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid investment weight.");
    const { symbol, basisPoints } = entry as Record<string, unknown>;
    if (
      typeof symbol !== "string" ||
      !FLOW_SYMBOLS.some((allowed) => allowed === symbol) ||
      seen.has(symbol)
    )
      throw new Error("Choose unique supported investment assets.");
    if (
      typeof basisPoints !== "number" ||
      !Number.isInteger(basisPoints) ||
      basisPoints < 1 ||
      basisPoints > 10000
    )
      throw new Error("Weights must be positive integer basis points.");
    seen.add(symbol);
    total += basisPoints;
    return { symbol, basisPoints };
  });
  if (result.length && total !== 10000) throw new Error("Investment weights must total 100%.");
  return { cashTargetBase, weights: result };
}
