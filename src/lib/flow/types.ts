/** JSON boundaries use integer micro-USDC strings; calculations use BigInt. */
export interface FlowWeight { symbol: string; basisPoints: number }
export interface FlowSettings { cashTargetBase: string; weights: FlowWeight[]; revision: number }
export interface FlowPurchase { symbol: string; amountBase: string }
export interface FlowAllocation {
  paymentBase: string;
  cashBase: string;
  investmentBase: string;
  purchases: FlowPurchase[];
}
export interface FlowInvoice {
  id: string;
  amountBase: string;
  recipientWallet: string;
  reference: string;
  status: "pending" | "paid" | "expired" | "cancelled";
  payUrl: string;
  solanaPayUri: string;
}
export interface FlowPayment extends FlowAllocation {
  id: string;
  invoiceId: string;
  signature: string;
  settingsRevision: number;
  createdAt: string;
}
export type PurchaseState = "pending" | "deferred" | "approved" | "submitted" | "confirmed" | "failed" | "cancelled";
