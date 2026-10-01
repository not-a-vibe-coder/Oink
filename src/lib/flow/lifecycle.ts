import type { PurchaseState } from "./types";
const next: Record<PurchaseState, readonly PurchaseState[]> = {
  pending: ["deferred", "approved", "cancelled"],
  deferred: ["pending", "cancelled"],
  approved: ["pending", "submitted", "cancelled"],
  submitted: ["confirmed", "failed"],
  confirmed: [],
  failed: ["pending", "cancelled"],
  cancelled: [],
};
export function canTransition(from: PurchaseState, to: PurchaseState): boolean {
  return next[from].includes(to);
}
export function reservesCash(state: PurchaseState): boolean {
  return state !== "confirmed" && state !== "cancelled";
}
