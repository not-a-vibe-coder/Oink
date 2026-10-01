import type { PoolClient } from "pg";
import { FlowError } from "./settings";
/** An unresolved spend may already be reflected in balances; never count it twice. */
export async function requireSettledReservations(
  client: PoolClient,
  accountId: string,
): Promise<void> {
  const result = await client.query(
    "SELECT p.id FROM flow_purchases p JOIN flow_payments f ON f.id=p.payment_id WHERE f.account_id=$1 AND p.state='submitted' LIMIT 1",
    [accountId],
  );
  if (result.rows.length)
    throw new FlowError(
      "RECONCILIATION_REQUIRED",
      "Check the submitted investment before allocating or preparing more income.",
      409,
    );
}
