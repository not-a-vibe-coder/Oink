import { baseAmount } from "../flow/amounts";
import type { BellDecision, BellPolicy } from "./types";
export const DEFAULT_BELL_POLICY: BellPolicy = {
  slippageBps: 50,
  maxTokenPriceBase: null,
  maxPriceImpactBps: 200,
  maxPremiumBps: null,
};
export function validateBellPolicy(value: unknown): BellPolicy {
  if (!value || typeof value !== "object") throw new Error("Provide execution limits.");
  const input = value as Record<string, unknown>;
  const bps = (raw: unknown, min: number, max: number): number => {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max)
      throw new Error("Execution limits must use valid integer basis points.");
    return raw;
  };
  const price =
    input.maxTokenPriceBase === null ? null : baseAmount(input.maxTokenPriceBase).toString();
  if (price === "0") throw new Error("A maximum token price must be positive.");
  return {
    slippageBps: bps(input.slippageBps, 1, 500),
    maxTokenPriceBase: price,
    maxPriceImpactBps:
      input.maxPriceImpactBps === null ? null : bps(input.maxPriceImpactBps, 0, 10000),
    maxPremiumBps: input.maxPremiumBps === null ? null : bps(input.maxPremiumBps, 0, 10000),
  };
}
/** Rational parsing avoids rounding a quote across the user's limit. */
export function decimalRatio(value: string): { numerator: bigint; denominator: bigint } {
  if (!/^-?\d{1,20}(\.\d{1,40})?$/.test(value)) throw new Error("Invalid decimal ratio.");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return {
    numerator: BigInt(whole + fraction) * (negative ? -1n : 1n),
    denominator: 10n ** BigInt(fraction.length),
  };
}
export interface PolicyQuote {
  inAmount: string;
  outAmount: string;
  minimumOutput: string;
  outputDecimals: number;
  slippageBps: number;
  priceImpact: string | null;
  expiresAt: string;
}
export function evaluateBellPolicy(
  quote: PolicyQuote,
  policy: BellPolicy,
  now = Date.now(),
): BellDecision {
  const decision = (
    status: BellDecision["status"],
    reason: BellDecision["reason"],
    message: string,
  ): BellDecision => ({ status, reason, message });
  try {
    validateBellPolicy(policy);
    const input = baseAmount(quote.inAmount),
      output = baseAmount(quote.outAmount),
      minimum = baseAmount(quote.minimumOutput);
    if (
      !input ||
      !output ||
      !minimum ||
      minimum > output ||
      !Number.isInteger(quote.outputDecimals) ||
      quote.outputDecimals < 0 ||
      quote.outputDecimals > 18 ||
      quote.slippageBps !== policy.slippageBps ||
      minimum < (output * BigInt(10000 - policy.slippageBps)) / 10000n
    )
      throw new Error("Invalid quote.");
    const expires = Date.parse(quote.expiresAt);
    if (!Number.isFinite(expires)) throw new Error("Invalid quote expiry.");
    if (now >= expires)
      return decision(
        "defer",
        "QUOTE_EXPIRED",
        "This quote expired. Request a fresh execution brief.",
      );
    if (policy.maxPremiumBps !== null)
      return decision(
        "unavailable",
        "REFERENCE_UNAVAILABLE",
        "A premium limit needs verified equity reference data, which is unavailable.",
      );
    if (
      policy.maxTokenPriceBase !== null &&
      input * 10n ** BigInt(quote.outputDecimals) > BigInt(policy.maxTokenPriceBase) * minimum
    )
      return decision("defer", "PRICE_LIMIT", "The worst-case token price exceeds your limit.");
    if (policy.maxPriceImpactBps !== null) {
      if (quote.priceImpact === null)
        return decision(
          "unavailable",
          "PRICE_IMPACT_UNAVAILABLE",
          "The route did not provide price-impact evidence.",
        );
      const ratio = decimalRatio(quote.priceImpact);
      const absolute = ratio.numerator < 0n ? -ratio.numerator : ratio.numerator;
      if (absolute * 10000n > BigInt(policy.maxPriceImpactBps) * ratio.denominator)
        return decision("defer", "PRICE_IMPACT_LIMIT", "Reported price impact exceeds your limit.");
    }
    return decision("pass", "WITHIN_LIMITS", "This quote meets your execution limits.");
  } catch {
    return decision(
      "unavailable",
      "INVALID_QUOTE",
      "The quote could not be verified against your limits.",
    );
  }
}
export function displayTokenAmount(value: string, decimals: number): string {
  const amount = baseAmount(value),
    scale = 10n ** BigInt(decimals);
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${amount / scale}${fraction ? `.${fraction}` : ""}`;
}
export function displayImpactPercent(value: string): string {
  const ratio = decimalRatio(value);
  const hundredths = (ratio.numerator * 10000n) / ratio.denominator;
  const absolute = hundredths < 0n ? -hundredths : hundredths;
  return `${hundredths < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}%`;
}
