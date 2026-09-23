import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { query } from "../db";
import { identifierLookup, parseIdentifier } from "../lib/accountId";
import { requireSession } from "../middleware/session";
import {
  calculateMixQuotes,
  getStoredQuote,
  type MixLeg,
  type QuoteRecipient,
} from "../services/mixEngine";
import { checkSponsorshipBudget, recordSponsorship } from "../services/feePayer";
import { buildSettlementTransaction, type BuiltTransactionPlan } from "../services/txBuilder";
import { broadcastAndConfirmTransaction } from "../services/rpc";

export const transferRouter = Router();

// Store built plans for submit re-validation: quoteId -> BuiltTransactionPlan
const builtPlans = new Map<string, BuiltTransactionPlan & { createdAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [id, plan] of builtPlans.entries()) {
    if (now - plan.createdAt > 60_000) {
      builtPlans.delete(id);
    }
  }
}, 10_000);

function isSolanaAddress(addr: string): boolean {
  try {
    new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}

// POST /api/v1/transfer/quote [S]
transferRouter.post("/quote", requireSession, async (req: Request, res: Response) => {
  const { recipient, fromSymbolOrMint, amountIn, applyMix = true, slippageBps } = req.body || {};
  const senderAccountId = req.accountId!;

  if (!recipient || !fromSymbolOrMint || !amountIn) {
    res.status(400).json({
      error: "VALIDATION_FAILED",
      message: "recipient, fromSymbolOrMint, and amountIn are required.",
      details: null,
    });
    return;
  }

  try {
    // 1. Get sender wallet public key
    const senderRes = await query("SELECT public_key FROM wallets WHERE account_id = $1", [senderAccountId]);
    if (senderRes.rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Sender wallet not found.", details: null });
      return;
    }
    const senderWallet = senderRes.rows[0].public_key;

    // 2. Resolve recipient
    let resolvedRecipient: QuoteRecipient;
    let mix: MixLeg[] = [];
    let effectiveApplyMix = applyMix;

    const trimmedRecipient = String(recipient).trim();
    if (isSolanaAddress(trimmedRecipient)) {
      resolvedRecipient = {
        kind: "address",
        wallet: trimmedRecipient,
      };
      effectiveApplyMix = false; // Raw external address has no mix
    } else {
      const id = parseIdentifier(trimmedRecipient);
      const recRes = id
        ? await query(
            `SELECT account_id, tag, public_key, display_name FROM wallets
             WHERE ${identifierLookup(id).where} AND status = 'active'`,
            [identifierLookup(id).value],
          )
        : { rows: [] as any[] };

      if (recRes.rows.length === 0) {
        res.status(404).json({ error: "NOT_FOUND", message: `Recipient ${trimmedRecipient} not found.`, details: null });
        return;
      }

      const rec = recRes.rows[0];
      resolvedRecipient = {
        kind: "account",
        accountId: rec.account_id,
        tag: rec.tag,
        wallet: rec.public_key,
        displayName: rec.display_name || (rec.tag ? `@${rec.tag}` : rec.account_id),
      };

      if (effectiveApplyMix) {
        const mixRes = await query(
          "SELECT asset_symbol, asset_mint, basis_points FROM mixes WHERE account_id = $1 AND is_active = true",
          [rec.account_id],
        );
        mix = mixRes.rows.map((r) => ({
          symbol: r.asset_symbol,
          mint: r.asset_mint,
          basisPoints: r.basis_points,
        }));
      }
    }

    // 3. Sponsorship check
    const sponsorship = await checkSponsorshipBudget(senderAccountId);

    // 4. Calculate quotes
    const quote = await calculateMixQuotes({
      senderAccountId,
      senderWallet,
      recipient: resolvedRecipient,
      fromSymbolOrMint,
      amountInFormatted: String(amountIn),
      mix,
      applyMix: effectiveApplyMix,
      slippageBps,
    });

    res.status(200).json({
      recipient: quote.recipient,
      inputToken: {
        symbol: quote.inputToken.symbol,
        mint: quote.inputToken.mint,
        decimals: quote.inputToken.decimals,
      },
      totalIn: quote.totalIn,
      legs: quote.legs.map((leg) => ({
        symbol: leg.symbol,
        mint: leg.mint,
        basisPoints: leg.basisPoints,
        inAmount: leg.inAmount,
        outAmount: leg.outAmount,
        outAmountFormatted: leg.outAmountFormatted,
        priceImpactPct: leg.priceImpactPct,
        route: leg.route,
        safeSettled: leg.safeSettled,
      })),
      networkFeeLamports: quote.networkFeeLamports,
      sponsorship: {
        available: sponsorship.eligible,
        remainingToday: sponsorship.remainingToday,
      },
      quoteId: quote.quoteId,
      expiresAt: quote.expiresAt,
    });
  } catch (err: any) {
    console.error("Transfer quote error:", err);
    res.status(502).json({ error: "QUOTE_FAILED", message: err?.message || "Failed to generate quote.", details: null });
  }
});

// POST /api/v1/transfer/build [S]
transferRouter.post("/build", requireSession, async (req: Request, res: Response) => {
  const { quoteId, sponsorFee = true } = req.body || {};
  const senderAccountId = req.accountId!;

  if (!quoteId) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "quoteId is required.", details: null });
    return;
  }

  const quote = getStoredQuote(quoteId);
  if (!quote) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "Quote has expired or does not exist. Please re-quote.", details: null });
    return;
  }

  if (quote.senderAccountId && quote.senderAccountId !== senderAccountId) {
    res.status(403).json({ error: "FORBIDDEN", message: "Quote belongs to another account.", details: null });
    return;
  }

  try {
    let shouldSponsor = sponsorFee;
    if (shouldSponsor) {
      const budget = await checkSponsorshipBudget(senderAccountId);
      if (!budget.eligible) {
        res.status(429).json({
          error: "SPONSORSHIP_EXHAUSTED",
          message: budget.reason || "Daily fee sponsorship budget exhausted.",
          details: null,
        });
        return;
      }
    }

    const plan = await buildSettlementTransaction({ quote, sponsorFee: shouldSponsor });
    builtPlans.set(quoteId, { ...plan, createdAt: Date.now() });

    res.status(200).json({
      transaction: plan.transaction,
      feePayer: plan.feePayer,
      partiallySigned: plan.partiallySigned,
      lastValidBlockHeight: plan.lastValidBlockHeight,
      addressLookupTableAddresses: plan.addressLookupTableAddresses,
    });
  } catch (err: any) {
    console.error("Transfer build error:", err);
    res.status(500).json({ error: "INTERNAL", message: err?.message || "Failed to build transaction.", details: null });
  }
});

// POST /api/v1/transfer/submit [S]
transferRouter.post("/submit", requireSession, async (req: Request, res: Response) => {
  const { quoteId, signedTransaction } = req.body || {};
  const senderAccountId = req.accountId!;

  if (!quoteId || !signedTransaction) {
    res.status(400).json({
      error: "VALIDATION_FAILED",
      message: "quoteId and signedTransaction are required.",
      details: null,
    });
    return;
  }

  const quote = getStoredQuote(quoteId);
  const plan = builtPlans.get(quoteId);

  if (!quote || !plan) {
    res.status(400).json({
      error: "VALIDATION_FAILED",
      message: "Transaction build expired. Please quote and sign again.",
      details: null,
    });
    return;
  }

  try {
    // 1. Mandatory server-side re-validation
    const txBytes = Buffer.from(signedTransaction, "base64");
    const deserializedTx = VersionedTransaction.deserialize(txBytes);

    const clientMsgBytes = deserializedTx.message.serialize();
    const clientMsgHash = crypto.createHash("sha256").update(clientMsgBytes).digest("hex");

    if (clientMsgHash !== plan.messageHash) {
      res.status(400).json({
        error: "VALIDATION_FAILED",
        message: "Transaction message differs from the one built by the server.",
        details: null,
      });
      return;
    }

    // 2. Broadcast and wait for confirmation
    const broadcastRes = await broadcastAndConfirmTransaction(txBytes);

    if (broadcastRes.status === "failed") {
      // Record failed transfer
      await query(
        `INSERT INTO transfers (
          signature, direction, sender_account_id, sender_wallet, recipient_account_id, recipient_wallet,
          input_mint, input_symbol, input_amount, output_breakdown, mix_applied, fee_sponsored,
          status, created_at
        ) VALUES ($1, 'send', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'failed', NOW())
        ON CONFLICT (signature) DO NOTHING`,
        [
          broadcastRes.signature,
          senderAccountId,
          quote.senderWallet,
          quote.recipient.accountId || null,
          quote.recipient.wallet,
          quote.inputToken.mint,
          quote.inputToken.symbol,
          quote.totalIn,
          JSON.stringify(quote.legs),
          quote.applyMix,
          plan.partiallySigned,
        ],
      );

      res.status(500).json({
        error: "INTERNAL",
        message: `Transaction failed on-chain: ${broadcastRes.error}`,
        details: null,
      });
      return;
    }

    const signature = broadcastRes.signature;

    // 3. Record transfer
    const insertRes = await query(
      `INSERT INTO transfers (
        signature, direction, sender_account_id, sender_wallet, recipient_account_id, recipient_wallet,
        input_mint, input_symbol, input_amount, output_breakdown, mix_applied, fee_sponsored,
        fee_lamports, status, confirmed_at, created_at
      ) VALUES ($1, 'send', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'confirmed', NOW(), NOW())
      ON CONFLICT (signature) DO NOTHING
      RETURNING id`,
      [
        signature,
        senderAccountId,
        quote.senderWallet,
        quote.recipient.accountId || null,
        quote.recipient.wallet,
        quote.inputToken.mint,
        quote.inputToken.symbol,
        quote.totalIn,
        JSON.stringify(quote.legs),
        quote.applyMix,
        plan.partiallySigned,
        15000,
      ],
    );

    // 4. Record fee sponsorship if sponsored
    if (plan.partiallySigned) {
      await recordSponsorship(senderAccountId, signature, 15000n);
    }

    const transferId = insertRes.rows[0]?.id;

    res.status(200).json({
      signature,
      status: "confirmed",
      explorerUrl: `https://solscan.io/tx/${signature}`,
      transferId,
    });
  } catch (err: any) {
    console.error("Transfer submit error:", err);
    res.status(500).json({ error: "INTERNAL", message: err?.message || "Failed to submit transaction.", details: null });
  }
});

// Tags are joined in at read time rather than stored, because a tag can be claimed or move
// after the transfer happened (docs/12 §3).
const TRANSFER_COLUMNS = `t.id, t.signature, t.direction, t.sender_account_id, s.tag AS sender_tag, t.sender_wallet,
  t.recipient_account_id, r.tag AS recipient_tag, t.recipient_wallet, t.input_mint, t.input_symbol,
  t.input_amount, t.output_breakdown, t.mix_applied, t.fee_sponsored, t.memo, t.source, t.status,
  t.confirmed_at, t.created_at`;
const TRANSFER_JOINS = `LEFT JOIN wallets s ON s.account_id = t.sender_account_id
  LEFT JOIN wallets r ON r.account_id = t.recipient_account_id`;

// GET /api/v1/transfer/history [S]
transferRouter.get("/history", requireSession, async (req: Request, res: Response) => {
  const accountId = req.accountId!;
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
  const offset = Math.max(0, parseInt((req.query.offset as string) || "0", 10));

  try {
    const countRes = await query(
      "SELECT COUNT(*) as count FROM transfers WHERE sender_account_id = $1 OR recipient_account_id = $1",
      [accountId],
    );
    const total = parseInt(countRes.rows[0]?.count || "0", 10);

    const rows = await query(
      `SELECT ${TRANSFER_COLUMNS}
       FROM transfers t ${TRANSFER_JOINS}
       WHERE t.sender_account_id = $1 OR t.recipient_account_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [accountId, limit, offset],
    );

    res.status(200).json({
      transfers: rows.rows.map((r) => ({
        ...r,
        isOutgoing: r.sender_account_id === accountId,
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("Transfer history error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to fetch transfer history.", details: null });
  }
});

// GET /api/v1/transfer/:signature [S] — only the sender or recipient can read a receipt.
transferRouter.get("/:signature", requireSession, async (req: Request, res: Response) => {
  const signature = req.params.signature;

  try {
    const resRow = await query(
      `SELECT ${TRANSFER_COLUMNS}
       FROM transfers t ${TRANSFER_JOINS}
       WHERE t.signature = $1 AND (t.sender_account_id = $2 OR t.recipient_account_id = $2)`,
      [signature, req.accountId],
    );
    if (resRow.rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Transfer receipt not found.", details: null });
      return;
    }

    res.status(200).json(resRow.rows[0]);
  } catch (err) {
    console.error("Transfer receipt error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to fetch receipt.", details: null });
  }
});
