import { allocateIncome } from "../flow/allocation";
import { DEFAULT_BELL_POLICY, evaluateBellPolicy } from "../bell/policy";
import type { BellQuote } from "../bell/types";
export const DEMO_ALLOCATION = allocateIncome("500000000", "800000000", "1000000000", [
  { symbol: "SPYx", basisPoints: 6000 },
  { symbol: "AAPLx", basisPoints: 4000 },
]);
/** Fictional quote evidence uses the production arithmetic, never a signing or RPC path. */
export function demoQuotes(now: number): BellQuote[] {
  return DEMO_ALLOCATION.purchases.map((purchase, index) => {
    const policy = { ...DEFAULT_BELL_POLICY, maxTokenPriceBase: index === 1 ? "100000000" : null };
    const quote: BellQuote = {
      id: `demo_quote_${purchase.symbol}`,
      purchaseId: `demo_purchase_${purchase.symbol}`,
      symbol: purchase.symbol,
      name: index === 0 ? "S&P 500 xStock" : "Apple xStock",
      issuer: "Backed / xStocks",
      instrumentUrl: "https://assets.backed.fi/legal-documentation",
      inputMint: "demo_usdc",
      outputMint: `demo_${purchase.symbol}`,
      outputDecimals: 8,
      inAmount: purchase.amountBase,
      outAmount: index === 0 ? "30000000" : "60000000",
      minimumOutput: index === 0 ? "29850000" : "59700000",
      priceImpact: "0.001",
      route: ["Illustrative route"],
      policy,
      decision: { status: "unavailable", reason: "ROUTE_UNAVAILABLE", message: "Not evaluated" },
      quotedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 30000).toISOString(),
      reference: { status: "unavailable", marketSession: "unknown" },
    };
    quote.decision = evaluateBellPolicy({ ...quote, slippageBps: 50 }, policy, now);
    return quote;
  });
}
