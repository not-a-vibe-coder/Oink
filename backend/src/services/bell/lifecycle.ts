import { FlowError, inFlowTransaction, lockSettings } from "../flow/settings";
import { purchaseRecord } from "./quotes";
export function changeBellPurchase(
  accountId: string,
  id: string,
  action: "retry" | "cancel",
): Promise<{ state: "pending" | "cancelled" }> {
  return inFlowTransaction(async (client) => {
    await lockSettings(client, accountId);
    const purchase = await purchaseRecord(client, accountId, id);
    if (action === "cancel" && purchase.state === "cancelled") return { state: "cancelled" };
    if (!["pending", "deferred", "approved", "failed"].includes(purchase.state))
      throw new FlowError(
        "CONFLICT",
        "A submitted purchase must be reconciled, and a completed purchase cannot be retried or cancelled.",
        409,
      );
    const active = await client.query(
      "SELECT id FROM bell_attempts WHERE purchase_id=$1 AND state='submitted'",
      [id],
    );
    if (active.rows.length)
      throw new FlowError(
        "RECONCILIATION_REQUIRED",
        "Reconcile the submitted transaction before changing this purchase.",
        409,
      );
    await client.query(
      "UPDATE bell_attempts SET state=$2,reason=$3 WHERE purchase_id=$1 AND state='prepared'",
      [
        id,
        action === "cancel" ? "cancelled" : "superseded",
        action === "cancel" ? "USER_CANCELLED" : "USER_REFRESHED",
      ],
    );
    const state = action === "cancel" ? "cancelled" : "pending";
    await client.query(
      "UPDATE flow_purchases SET state=$2,attempt_id=NULL,quote_id=NULL WHERE id=$1",
      [id, state],
    );
    return { state };
  });
}
