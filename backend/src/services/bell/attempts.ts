import type { PoolClient } from "pg";
import { nanoid } from "nanoid";
import type {
  BellAttempt,
  BellPrepared,
  BellReceipt,
  BellSimulation,
} from "../../../../src/lib/bell/types";
import { evaluateBellPolicy } from "../../../../src/lib/bell/policy";
import { FlowError, inFlowTransaction, lockSettings } from "../flow/settings";
import { freshUsdcBalance } from "../flow/chain";
import { reservedCash } from "../flow/allocation";
import { requireSettledReservations } from "../flow/reservations";
import { purchaseRecord, quoteRecord, type PurchaseRecord } from "./quotes";
import { bellNetworkSupported } from "./assets";
import { assembleBellTransaction } from "./transaction";
export interface AttemptRecord {
  id: string;
  purchase_id: string;
  quote_id: string;
  account_id: string;
  state: BellAttempt["state"];
  unsigned_transaction: string;
  message_hash: string;
  blockhash: string;
  last_valid_block_height: string;
  expires_at: Date;
  simulation: BellSimulation;
  signature: string | null;
  receipt: BellReceipt | null;
  reason: string | null;
}
export function attemptResponse(row: AttemptRecord): BellAttempt {
  return {
    id: row.id,
    purchaseId: row.purchase_id,
    quoteId: row.quote_id,
    state: row.state,
    signature: row.signature,
    receipt: row.receipt,
    reason: row.reason,
    simulation: row.simulation,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}
export async function attemptRecord(
  client: PoolClient,
  accountId: string,
  id: string,
): Promise<AttemptRecord> {
  const result = await client.query<AttemptRecord>(
    "SELECT * FROM bell_attempts WHERE id=$1 AND account_id=$2 FOR UPDATE",
    [id, accountId],
  );
  if (!result.rows[0]) throw new FlowError("NOT_FOUND", "Execution attempt not found.", 404);
  return result.rows[0];
}
export async function requirePurchaseBacking(
  client: PoolClient,
  accountId: string,
  purchase: PurchaseRecord,
): Promise<void> {
  const slots = await client.query<{ slot: string | null }>(
    "SELECT MAX((receipt->>'slot')::bigint)::text AS slot FROM bell_attempts WHERE account_id=$1 AND state='confirmed'",
    [accountId],
  );
  const minSlot = Math.max(Number(purchase.receipt_slot), Number(slots.rows[0]?.slot ?? 0));
  const balance = await freshUsdcBalance(purchase.wallet, purchase.input_mint, minSlot);
  if (balance < (await reservedCash(client, accountId)))
    throw new FlowError(
      "INSUFFICIENT_BACKING",
      "Pending investments are not fully backed by available USDC.",
      409,
    );
}
export function prepareBellPurchase(
  accountId: string,
  purchaseId: string,
  quoteId: string,
): Promise<BellPrepared> {
  return inFlowTransaction(async (client) => {
    await lockSettings(client, accountId);
    await requireSettledReservations(client, accountId);
    const purchase = await purchaseRecord(client, accountId, purchaseId),
      quote = await quoteRecord(client, accountId, quoteId);
    if (
      purchase.quote_id !== quoteId ||
      quote.purchase_id !== purchaseId ||
      !["pending", "approved"].includes(purchase.state)
    )
      throw new FlowError(
        "CONFLICT",
        "Request a current passing quote before preparing this purchase.",
        409,
      );
    if (!bellNetworkSupported(purchase.input_mint))
      throw new FlowError("NETWORK_UNSUPPORTED", "Stock execution requires mainnet USDC.", 409);
    if (
      !quote.provider_build ||
      quote.brief.decision.status !== "pass" ||
      evaluateBellPolicy(
        { ...quote.brief, slippageBps: quote.brief.policy.slippageBps },
        quote.brief.policy,
      ).status !== "pass"
    )
      throw new FlowError(
        "QUOTE_EXPIRED",
        "The quote no longer meets your limits. Refresh it before signing.",
        409,
      );
    await requirePurchaseBacking(client, accountId, purchase);
    if (purchase.state === "approved") {
      const existing = await client.query<AttemptRecord>(
        "SELECT * FROM bell_attempts WHERE purchase_id=$1 AND state='prepared'",
        [purchaseId],
      );
      if (existing.rows[0])
        return {
          attempt: attemptResponse(existing.rows[0]),
          quote: quote.brief,
          transaction: existing.rows[0].unsigned_transaction,
        };
    }
    const plan = await assembleBellTransaction(quote.provider_build, quote.brief, purchase.wallet);
    if (Date.now() >= Date.parse(quote.brief.expiresAt))
      throw new FlowError(
        "QUOTE_EXPIRED",
        "The quote expired while preparing. Refresh and review again.",
        409,
      );
    const id = `attempt_${nanoid(16)}`;
    const inserted = await client.query<AttemptRecord>(
      "INSERT INTO bell_attempts (id,purchase_id,quote_id,account_id,unsigned_transaction,message_hash,blockhash,last_valid_block_height,expires_at,simulation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [
        id,
        purchaseId,
        quoteId,
        accountId,
        plan.transaction,
        plan.messageHash,
        plan.blockhash,
        plan.lastValidBlockHeight,
        quote.brief.expiresAt,
        JSON.stringify(plan.simulation),
      ],
    );
    await client.query("UPDATE flow_purchases SET state='approved',attempt_id=$2 WHERE id=$1", [
      purchaseId,
      id,
    ]);
    return {
      attempt: attemptResponse(inserted.rows[0]),
      quote: quote.brief,
      transaction: plan.transaction,
    };
  });
}
