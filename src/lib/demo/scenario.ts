import { allocateIncome } from "../flow/allocation";
import { DEFAULT_BELL_POLICY, evaluateBellPolicy } from "../bell/policy";
import type { BellQuote } from "../bell/types";
import {
  EMPTY_ORDER_COUNTS,
  nextPaydayAction,
  reserveProgress,
  type PaydaySummary,
} from "../flow/journey";
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

export type DemoStage =
  "request" | "received" | "allocated" | "quoted" | "prepared" | "submitted" | "completed";

/**
 * The fictional payday card for each walkthrough step, computed with the same reserve and
 * next-action rules as the API summary. Balances are the scenario's: 800 before payment,
 * +500 received, −180 for the completed SPYx fill.
 */
export function demoSummary(stage: DemoStage): PaydaySummary {
  const orders = { ...EMPTY_ORDER_COUNTS };
  let balance: bigint | null = 800_000_000n;
  let reserved = 0n;
  let unallocatedPayments = 0;
  let openInvoices = 0;
  if (stage === "request") openInvoices = 1;
  else if (stage === "received") {
    balance = 1_300_000_000n;
    unallocatedPayments = 1;
  } else if (stage === "submitted") {
    // An unresolved broadcast hides the reserve, exactly as the API does.
    balance = null;
    orders.submitted = 1;
    orders.deferred = 1;
  } else if (stage === "completed") {
    balance = 1_120_000_000n;
    reserved = 120_000_000n;
    orders.confirmed = 1;
    orders.deferred = 1;
  } else {
    balance = 1_300_000_000n;
    reserved = BigInt(DEMO_ALLOCATION.investmentBase);
    orders.pending = 2;
  }
  const counts = { planConfigured: true, unallocatedPayments, openInvoices };
  return {
    ...counts,
    reserve: reserveProgress(1_000_000_000n, balance, reserved),
    orders,
    nextAction: nextPaydayAction({ ...counts, orders }),
  };
}
