import type { PurchaseState } from "../flow/types";
export interface BellPolicy {
  slippageBps: number;
  maxTokenPriceBase: string | null;
  maxPriceImpactBps: number | null;
  maxPremiumBps: number | null;
}
export type BellReason =
  | "WITHIN_LIMITS"
  | "QUOTE_EXPIRED"
  | "INVALID_QUOTE"
  | "PRICE_LIMIT"
  | "PRICE_IMPACT_LIMIT"
  | "PRICE_IMPACT_UNAVAILABLE"
  | "REFERENCE_UNAVAILABLE"
  | "ROUTE_UNAVAILABLE"
  | "NETWORK_UNSUPPORTED";
export interface BellDecision {
  status: "pass" | "defer" | "unavailable";
  reason: BellReason;
  message: string;
}
export interface BellQuote {
  id: string;
  purchaseId: string;
  symbol: string;
  name: string;
  issuer: string;
  instrumentUrl: string;
  inputMint: string;
  outputMint: string;
  outputDecimals: number;
  inAmount: string;
  outAmount: string;
  minimumOutput: string;
  priceImpact: string | null;
  route: string[];
  policy: BellPolicy;
  decision: BellDecision;
  quotedAt: string;
  expiresAt: string;
  reference: { status: "unavailable"; marketSession: "unknown" };
}
export interface BellPurchase {
  id: string;
  paymentId: string;
  symbol: string;
  amountBase: string;
  state: PurchaseState;
  quote: BellQuote | null;
}
