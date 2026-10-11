import {
  EMPTY_ORDER_COUNTS,
  nextPaydayAction,
  reserveProgress,
  type PaydaySummary,
} from "../../../../src/lib/flow/journey";
import type { PurchaseState } from "../../../../src/lib/flow/types";
import { reservedCash } from "./allocation";
import { flowUsdcMint, freshUsdcBalance } from "./chain";
import { inFlowTransaction } from "./settings";

/**
 * Read-only snapshot for the home "payday plan" card. The balance read is best effort: an RPC
 * or configuration failure reports the reserve as unavailable instead of guessing, and an
 * unresolved submission hides it too, because that spend may or may not be in the balance.
 * Nothing is locked: this is a display snapshot, and the RPC read happens after commit so it
 * never holds up an allocation.
 */
export async function flowSummary(accountId: string): Promise<PaydaySummary> {
  const snapshot = await inFlowTransaction(async (client) => {
    const settings = await client.query<{ cash_target_base: string; revision: number }>(
      "SELECT cash_target_base, revision FROM flow_settings WHERE account_id = $1",
      [accountId],
    );
    const wallet = await client.query<{ public_key: string }>(
      "SELECT public_key FROM wallets WHERE account_id = $1",
      [accountId],
    );
    const states = await client.query<{ state: PurchaseState; count: number }>(
      "SELECT p.state, COUNT(*)::int AS count FROM flow_purchases p JOIN flow_payments f ON f.id = p.payment_id WHERE f.account_id = $1 GROUP BY p.state",
      [accountId],
    );
    const orders = { ...EMPTY_ORDER_COUNTS };
    for (const row of states.rows) orders[row.state] = row.count;
    const invoices = await client.query<{ unallocated: number; open: number }>(
      "SELECT COUNT(*) FILTER (WHERE i.status = 'paid' AND f.id IS NULL)::int AS unallocated, COUNT(*) FILTER (WHERE i.status = 'pending' AND i.expires_at > NOW())::int AS open FROM flow_invoices i LEFT JOIN flow_payments f ON f.invoice_id = i.id WHERE i.account_id = $1",
      [accountId],
    );
    return {
      target: BigInt(settings.rows[0]?.cash_target_base ?? "0"),
      planConfigured: (settings.rows[0]?.revision ?? 0) > 0,
      wallet: wallet.rows[0]?.public_key ?? null,
      reserved: await reservedCash(client, accountId),
      orders,
      unallocatedPayments: invoices.rows[0].unallocated,
      openInvoices: invoices.rows[0].open,
    };
  });
  let balance: bigint | null = null;
  if (snapshot.orders.submitted === 0 && snapshot.wallet) {
    try {
      balance = await freshUsdcBalance(snapshot.wallet, flowUsdcMint());
    } catch {
      balance = null;
    }
  }
  const { planConfigured, orders, unallocatedPayments, openInvoices } = snapshot;
  return {
    planConfigured,
    reserve: reserveProgress(snapshot.target, balance, snapshot.reserved),
    unallocatedPayments,
    openInvoices,
    orders,
    nextAction: nextPaydayAction({ planConfigured, orders, unallocatedPayments, openInvoices }),
  };
}
