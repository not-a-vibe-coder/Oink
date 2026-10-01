import { nanoid } from "nanoid";
import type { PoolClient } from "pg";
import {
  DEFAULT_BELL_POLICY,
  evaluateBellPolicy,
  validateBellPolicy,
} from "../../../../src/lib/bell/policy";
import type { BellPolicy, BellPurchase, BellQuote } from "../../../../src/lib/bell/types";
import type { PurchaseState } from "../../../../src/lib/flow/types";
import { FlowError, inFlowTransaction, lockSettings } from "../flow/settings";
import { bellAsset, bellNetworkSupported } from "./assets";
import type { BellAttempt } from "../../../../src/lib/bell/types";
import { fetchBellBuild, type BellProviderBuild } from "./provider";
export interface PurchaseRecord {
  id: string;
  payment_id: string;
  symbol: string;
  amount_base: string;
  state: PurchaseState;
  quote_id: string | null;
  wallet: string;
  input_mint: string;
  receipt_slot: string;
}
export interface QuoteRecord {
  id: string;
  purchase_id: string;
  account_id: string;
  brief: BellQuote;
  provider_build: BellProviderBuild | null;
}
export async function purchaseRecord(
  client: PoolClient,
  accountId: string,
  id: string,
): Promise<PurchaseRecord> {
  const result = await client.query<PurchaseRecord>(
    "SELECT p.*, w.public_key AS wallet, i.token_mint AS input_mint, i.receipt_slot FROM flow_purchases p JOIN flow_payments f ON f.id=p.payment_id JOIN flow_invoices i ON i.id=f.invoice_id JOIN wallets w ON w.account_id=f.account_id WHERE p.id=$1 AND f.account_id=$2 AND w.status='active' FOR UPDATE OF p",
    [id, accountId],
  );
  if (!result.rows[0]) throw new FlowError("NOT_FOUND", "Investment purchase not found.", 404);
  return result.rows[0];
}
export async function quoteRecord(
  client: PoolClient,
  accountId: string,
  id: string,
): Promise<QuoteRecord> {
  const result = await client.query<QuoteRecord>(
    "SELECT * FROM bell_quotes WHERE id=$1 AND account_id=$2",
    [id, accountId],
  );
  if (!result.rows[0]) throw new FlowError("NOT_FOUND", "Execution quote not found.", 404);
  return result.rows[0];
}
export async function listBellPurchases(accountId: string): Promise<{ purchases: BellPurchase[] }> {
  return inFlowTransaction(async (client) => {
    const result = await client.query<{
      id: string;
      payment_id: string;
      symbol: string;
      amount_base: string;
      state: PurchaseState;
      brief: BellQuote | null;
      attempt: BellAttempt | null;
    }>(
      "SELECT p.*, q.brief, CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id',a.id,'purchaseId',a.purchase_id,'quoteId',a.quote_id,'state',a.state,'signature',a.signature,'reason',a.reason,'simulation',a.simulation,'receipt',a.receipt,'expiresAt',a.expires_at) END AS attempt FROM flow_purchases p JOIN flow_payments f ON f.id=p.payment_id LEFT JOIN bell_quotes q ON q.id=p.quote_id LEFT JOIN bell_attempts a ON a.id=p.attempt_id WHERE f.account_id=$1 ORDER BY p.created_at DESC LIMIT 100",
      [accountId],
    );
    return {
      purchases: result.rows.map((p) => ({
        id: p.id,
        paymentId: p.payment_id,
        symbol: p.symbol,
        amountBase: p.amount_base,
        state: p.state,
        quote: p.brief,
      })),
    };
  });
}
export function createBellQuote(
  accountId: string,
  id: string,
  requestedPolicy: unknown = DEFAULT_BELL_POLICY,
): Promise<BellQuote> {
  let policy: BellPolicy;
  try {
    policy = validateBellPolicy(requestedPolicy);
  } catch {
    throw new FlowError("VALIDATION_FAILED", "Provide valid execution limits.");
  }
  return inFlowTransaction(async (client) => {
    await lockSettings(client, accountId);
    const purchase = await purchaseRecord(client, accountId, id);
    if (!["pending", "deferred", "failed"].includes(purchase.state))
      throw new FlowError(
        "CONFLICT",
        "This purchase must be retried or reconciled before requesting another quote.",
        409,
      );
    const asset = bellAsset(purchase.symbol);
    const quotedAt = new Date(),
      expiresAt = new Date(quotedAt.getTime() + 30000);
    let build: BellProviderBuild | null = null;
    let quote: BellQuote = {
      id: `quote_${nanoid(16)}`,
      purchaseId: id,
      symbol: asset.symbol,
      name: asset.name,
      issuer: asset.issuer,
      instrumentUrl: asset.instrumentUrl,
      inputMint: purchase.input_mint,
      outputMint: asset.mint,
      outputDecimals: asset.decimals,
      inAmount: purchase.amount_base,
      outAmount: "0",
      minimumOutput: "0",
      priceImpact: null,
      route: [],
      policy,
      decision: {
        status: "unavailable",
        reason: "NETWORK_UNSUPPORTED",
        message: "Tokenized stock execution requires mainnet USDC.",
      },
      quotedAt: quotedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      reference: { status: "unavailable", marketSession: "unknown" },
    };
    if (bellNetworkSupported(purchase.input_mint)) {
      try {
        build = await fetchBellBuild({
          wallet: purchase.wallet,
          inputMint: purchase.input_mint,
          outputMint: asset.mint,
          amount: purchase.amount_base,
          slippageBps: policy.slippageBps,
        });
        quote = {
          ...quote,
          outAmount: build.outAmount,
          minimumOutput: (
            (BigInt(build.outAmount) * BigInt(10000 - policy.slippageBps)) /
            10000n
          ).toString(),
          priceImpact: typeof build.priceImpactPct === "string" ? build.priceImpactPct : null,
          route: build.routePlan.map((step) => step.swapInfo.label),
        };
        quote.decision = evaluateBellPolicy({ ...quote, slippageBps: build.slippageBps }, policy);
      } catch {
        build = null;
        quote.decision = {
          status: "unavailable",
          reason: "ROUTE_UNAVAILABLE",
          message: "A usable quote is unavailable. Your income remains in USDC.",
        };
      }
    }
    await client.query(
      "INSERT INTO bell_quotes (id,purchase_id,account_id,policy,brief,provider_build,decision,reason,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        quote.id,
        id,
        accountId,
        JSON.stringify(policy),
        JSON.stringify(quote),
        build ? JSON.stringify(build) : null,
        quote.decision.status,
        quote.decision.reason,
        expiresAt,
      ],
    );
    await client.query("UPDATE flow_purchases SET quote_id=$2, state=$3 WHERE id=$1", [
      id,
      quote.id,
      quote.decision.status === "pass" ? "pending" : "deferred",
    ]);
    return quote;
  });
}
