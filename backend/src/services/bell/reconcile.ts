import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import type { BellQuote, BellReceipt, BellAttempt } from "../../../../src/lib/bell/types";
import { getSolanaConnection } from "../txBuilder";
import { FlowError, inFlowTransaction, lockSettings } from "../flow/settings";
import { attemptRecord, attemptResponse, type AttemptRecord } from "./attempts";
import { purchaseRecord, quoteRecord } from "./quotes";
import { decimalRatio } from "../../../../src/lib/bell/policy";
export function bellFillReceipt(
  tx: ParsedTransactionWithMeta,
  quote: BellQuote,
  wallet: string,
): BellReceipt {
  if (!tx.meta || tx.meta.err)
    throw new FlowError("RECEIPT_UNAVAILABLE", "A successful finalized fill is required.", 409);
  const balances = (
    side: "preTokenBalances" | "postTokenBalances",
    mint: string,
    decimals: number,
  ): bigint => {
    const records = tx.meta![side];
    if (!records)
      throw new FlowError(
        "RECEIPT_UNAVAILABLE",
        "Finalized token balance evidence is unavailable.",
        409,
      );
    const relevant = records.filter((r) => r.mint === mint);
    if (relevant.some((r) => !r.owner))
      throw new FlowError("RECEIPT_UNAVAILABLE", "Token ownership evidence is incomplete.", 409);
    return relevant
      .filter((r) => r.owner === wallet)
      .reduce((sum, r) => {
        if (r.uiTokenAmount.decimals !== decimals || !/^\d+$/.test(r.uiTokenAmount.amount))
          throw new FlowError("RECEIPT_UNAVAILABLE", "Token amount evidence is invalid.", 409);
        return sum + BigInt(r.uiTokenAmount.amount);
      }, 0n);
  };
  const input =
    balances("preTokenBalances", quote.inputMint, 6) -
    balances("postTokenBalances", quote.inputMint, 6);
  const output =
    balances("postTokenBalances", quote.outputMint, quote.outputDecimals) -
    balances("preTokenBalances", quote.outputMint, quote.outputDecimals);
  const index = tx.transaction.message.accountKeys.findIndex((a) => a.pubkey.toBase58() === wallet);
  if (
    index < 0 ||
    !Number.isSafeInteger(tx.meta.fee) ||
    !Number.isSafeInteger(tx.meta.preBalances[index]) ||
    !Number.isSafeInteger(tx.meta.postBalances[index])
  )
    throw new FlowError(
      "RECEIPT_UNAVAILABLE",
      "Finalized network fee evidence is unavailable.",
      409,
    );
  const priceWithin =
    quote.policy.maxTokenPriceBase === null ||
    (output > 0n &&
      input * 10n ** BigInt(quote.outputDecimals) <=
        BigInt(quote.policy.maxTokenPriceBase) * output);
  return {
    inputBase: input.toString(),
    outputBase: output.toString(),
    networkFeeLamports: String(tx.meta.fee),
    solChangeLamports: (
      BigInt(tx.meta.postBalances[index]) - BigInt(tx.meta.preBalances[index])
    ).toString(),
    withinLimits:
      input === BigInt(quote.inAmount) && output >= BigInt(quote.minimumOutput) && priceWithin,
    slot: tx.slot,
  };
}
export function reconcileBellAttempt(accountId: string, id: string): Promise<BellAttempt> {
  return inFlowTransaction(async (client) => {
    await lockSettings(client, accountId);
    const attempt = await attemptRecord(client, accountId, id);
    if (attempt.state !== "submitted" || !attempt.signature) return attemptResponse(attempt);
    const purchase = await purchaseRecord(client, accountId, attempt.purchase_id),
      quote = await quoteRecord(client, accountId, attempt.quote_id),
      connection = getSolanaConnection();
    // Use finalized evidence, not an HTTP timeout or a missing recent status, to release a reservation.
    const tx = await connection.getParsedTransaction(attempt.signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    let state: AttemptRecord["state"] = "submitted",
      reason: string | null = attempt.reason,
      receipt: BellReceipt | null = null;
    if (tx?.meta) {
      if (tx.transaction.signatures[0] !== attempt.signature)
        throw new FlowError(
          "RECEIPT_UNAVAILABLE",
          "The RPC returned a different transaction.",
          503,
        );
      if (tx.meta.err) {
        state = "failed";
        reason = "CHAIN_FAILED";
      } else {
        receipt = bellFillReceipt(tx, quote.brief, purchase.wallet);
        state = "confirmed";
        reason = receipt.withinLimits ? null : "EXECUTION_MISMATCH";
      }
    } else {
      const status = await connection.getSignatureStatuses([attempt.signature], {
        searchTransactionHistory: true,
      });
      if (status.value[0]) reason = "AWAITING_FINALIZED_RECEIPT";
      else {
        const finalizedHeight = await connection.getBlockHeight("finalized");
        if (finalizedHeight > Number(attempt.last_valid_block_height)) {
          // Repeat the history lookup after the finalized height check to avoid an expiry race.
          const finalStatus = await connection.getSignatureStatuses([attempt.signature], {
            searchTransactionHistory: true,
          });
          const finalTx = await connection.getParsedTransaction(attempt.signature, {
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          });
          if (!finalStatus.value[0] && !finalTx) {
            state = "expired";
            reason = "BLOCKHASH_EXPIRED";
          } else reason = "AWAITING_FINALIZED_RECEIPT";
        } else reason = "AWAITING_CONFIRMATION";
      }
    }
    const result = await client.query<AttemptRecord>(
      "UPDATE bell_attempts SET state=$2,reason=$3,receipt=$4,reconciled_at=CASE WHEN $2='submitted' THEN NULL ELSE NOW() END WHERE id=$1 RETURNING *",
      [id, state, reason, receipt ? JSON.stringify(receipt) : null],
    );
    if (state !== "submitted")
      await client.query("UPDATE flow_purchases SET state=$2 WHERE id=$1", [
        purchase.id,
        state === "confirmed" ? "confirmed" : "failed",
      ]);
    return attemptResponse(result.rows[0]);
  });
}
