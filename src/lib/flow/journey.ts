/**
 * The payday journey ties Mix, Income (Flow) and Bell into one next step. Shared by the API
 * summary and the home card so both agree on what "next" means. Amounts are BigInt; the
 * reserve is only reported when a fresh balance was actually read (fail closed otherwise).
 */
import type { PurchaseState } from "./types";

export type PaydayAction =
  "set_plan" | "request_income" | "allocate" | "reconcile" | "review_orders" | "waiting";

export interface PaydayReserve {
  status: "available" | "unavailable";
  targetBase: string;
  /** Spendable USDC after open Bell reservations; null when the balance could not be read. */
  availableBase: string | null;
  /** min(available, target); null when unavailable. */
  filledBase: string | null;
  /** Integer basis points of the target that is funded, 0–10000. */
  progressBps: number | null;
}

export interface PaydaySummary {
  planConfigured: boolean;
  reserve: PaydayReserve;
  unallocatedPayments: number;
  openInvoices: number;
  orders: Record<PurchaseState, number>;
  nextAction: PaydayAction;
}

export const EMPTY_ORDER_COUNTS: Record<PurchaseState, number> = {
  pending: 0,
  deferred: 0,
  approved: 0,
  submitted: 0,
  confirmed: 0,
  failed: 0,
  cancelled: 0,
};

export function reserveProgress(
  targetBase: bigint,
  balanceBase: bigint | null,
  reservedBase: bigint,
): PaydayReserve {
  if (balanceBase === null)
    return {
      status: "unavailable",
      targetBase: targetBase.toString(),
      availableBase: null,
      filledBase: null,
      progressBps: null,
    };
  const available = balanceBase > reservedBase ? balanceBase - reservedBase : 0n;
  const filled = available < targetBase ? available : targetBase;
  const progress = targetBase === 0n ? 10000n : (filled * 10000n) / targetBase;
  return {
    status: "available",
    targetBase: targetBase.toString(),
    availableBase: available.toString(),
    filledBase: filled.toString(),
    progressBps: Number(progress),
  };
}

/** One action, most urgent first: an unresolved broadcast always outranks new work. */
export function nextPaydayAction(input: {
  planConfigured: boolean;
  unallocatedPayments: number;
  openInvoices: number;
  orders: Record<PurchaseState, number>;
}): PaydayAction {
  if (input.orders.submitted > 0) return "reconcile";
  if (input.unallocatedPayments > 0) return "allocate";
  if (
    input.orders.pending + input.orders.deferred + input.orders.approved + input.orders.failed >
    0
  )
    return "review_orders";
  if (!input.planConfigured) return "set_plan";
  if (input.openInvoices > 0) return "waiting";
  return "request_income";
}
