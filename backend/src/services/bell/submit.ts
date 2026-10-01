import { VersionedTransaction } from "@solana/web3.js";
import { evaluateBellPolicy } from "../../../../src/lib/bell/policy";
import type { BellAttempt } from "../../../../src/lib/bell/types";
import { FlowError, inFlowTransaction, lockSettings } from "../flow/settings";
import { requireSettledReservations } from "../flow/reservations";
import { getSolanaConnection } from "../txBuilder";
import { attemptRecord, attemptResponse, requirePurchaseBacking } from "./attempts";
import { purchaseRecord, quoteRecord } from "./quotes";
import { verifySignedBellTransaction } from "./signatures";
import { bellNetworkSupported } from "./assets";
export async function submitBellAttempt(
  accountId: string,
  id: string,
  signedTransaction: unknown,
): Promise<BellAttempt> {
  const accepted = await inFlowTransaction(async (client) => {
    await lockSettings(client, accountId);
    const attempt = await attemptRecord(client, accountId, id),
      purchase = await purchaseRecord(client, accountId, attempt.purchase_id);
    const signed = verifySignedBellTransaction(
      signedTransaction,
      attempt.message_hash,
      purchase.wallet,
    );
    if (attempt.signature && attempt.signature !== signed.signature)
      throw new FlowError(
        "CONFLICT",
        "This attempt already has a different transaction signature.",
        409,
      );
    if (attempt.state !== "prepared")
      return { attempt: attemptResponse(attempt), broadcast: false, bytes: signed.bytes };
    await requireSettledReservations(client, accountId);
    if (
      purchase.state !== "approved" ||
      purchase.quote_id !== attempt.quote_id ||
      !bellNetworkSupported(purchase.input_mint)
    )
      throw new FlowError("CONFLICT", "This execution plan is no longer active.", 409);
    const quote = await quoteRecord(client, accountId, attempt.quote_id);
    if (
      evaluateBellPolicy(
        { ...quote.brief, slippageBps: quote.brief.policy.slippageBps },
        quote.brief.policy,
      ).status !== "pass"
    )
      throw new FlowError(
        "QUOTE_EXPIRED",
        "Refresh the quote and review a new plan before signing.",
        409,
      );
    await requirePurchaseBacking(client, accountId, purchase);
    const connection = getSolanaConnection();
    const simulated = await connection.simulateTransaction(
      VersionedTransaction.deserialize(signed.bytes),
      { sigVerify: true, commitment: "confirmed" },
    );
    if (simulated.value.err)
      throw new FlowError(
        "SIMULATION_FAILED",
        "This signed trade could not be simulated. Refresh and review a new quote.",
        409,
      );
    if (
      (await connection.getBlockHeight("confirmed")) > Number(attempt.last_valid_block_height) ||
      Date.now() >= new Date(attempt.expires_at).getTime()
    )
      throw new FlowError(
        "QUOTE_EXPIRED",
        "This execution plan expired. Refresh and review again.",
        409,
      );
    const updated = await client.query<import("./attempts").AttemptRecord>(
      "UPDATE bell_attempts SET state='submitted',signature=$2,submitted_at=NOW(),reason=NULL WHERE id=$1 RETURNING *",
      [id, signed.signature],
    );
    await client.query("UPDATE flow_purchases SET state='submitted' WHERE id=$1", [purchase.id]);
    return { attempt: attemptResponse(updated.rows[0]), broadcast: true, bytes: signed.bytes };
  });
  // Once committed, every crash/timeout is reconciled using this deterministic signature.
  if (accepted.broadcast) {
    try {
      const signature = await getSolanaConnection().sendRawTransaction(accepted.bytes, {
        skipPreflight: false,
        maxRetries: 0,
      });
      if (signature !== accepted.attempt.signature) throw new Error("RPC signature mismatch.");
    } catch {
      accepted.attempt.reason = "BROADCAST_UNCERTAIN";
      await inFlowTransaction(async (client) => {
        await client.query(
          "UPDATE bell_attempts SET reason='BROADCAST_UNCERTAIN' WHERE id=$1 AND state='submitted'",
          [id],
        );
      });
    }
  }
  return accepted.attempt;
}
