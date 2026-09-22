import { Router, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import { getConfig } from "../config";
import { query } from "../db";
import { resolveSolanaToken, USDC } from "../lib/tokens";
import { requireSession } from "../middleware/session";

export const invoicesRouter = Router();

// POST /api/v1/invoices [S]
invoicesRouter.post("/", requireSession, async (req: Request, res: Response) => {
  const { amount, tokenSymbol = "USDC", memo, applyElection = true, expiresInHours = 72 } = req.body || {};
  const creatorTag = req.userTag!;

  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "Valid positive amount is required.", details: null });
    return;
  }

  const token = resolveSolanaToken(tokenSymbol);
  if (!token) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: `Unknown token: ${tokenSymbol}`, details: null });
    return;
  }

  try {
    const walletRes = await query("SELECT public_key FROM wallets WHERE tag = $1", [creatorTag]);
    if (walletRes.rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Creator wallet not found.", details: null });
      return;
    }

    const recipientWallet = walletRes.rows[0].public_key;
    const invoiceId = `inv_${nanoid(12)}`;
    const expiresAt = new Date(Date.now() + Number(expiresInHours) * 3600 * 1000);

    await query(
      `INSERT INTO invoices (
        id, creator_tag, recipient_wallet, amount, token_mint, token_symbol,
        memo, apply_election, status, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, NOW())`,
      [
        invoiceId,
        creatorTag,
        recipientWallet,
        String(amount),
        token.mint,
        token.symbol,
        memo || null,
        Boolean(applyElection),
        expiresAt,
      ],
    );

    const config = getConfig();
    const payUrl = `${config.appUrl}/pay/${invoiceId}`;
    const solanaPayUri = `solana:${recipientWallet}?amount=${amount}&spl-token=${token.mint}&memo=${encodeURIComponent(memo || invoiceId)}`;

    res.status(201).json({
      id: invoiceId,
      payUrl,
      solanaPayUri,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("Create invoice error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to create invoice.", details: null });
  }
});

// GET /api/v1/invoices [S] - Creator list
invoicesRouter.get("/", requireSession, async (req: Request, res: Response) => {
  const creatorTag = req.userTag!;

  try {
    const rows = await query(
      `SELECT id, amount, token_mint, token_symbol, memo, apply_election, status,
              signature, payer_wallet, payer_tag, expires_at, paid_at, created_at
       FROM invoices
       WHERE creator_tag = $1
       ORDER BY created_at DESC`,
      [creatorTag],
    );

    res.status(200).json({ invoices: rows.rows });
  } catch (err) {
    console.error("List invoices error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to list invoices.", details: null });
  }
});

// GET /api/v1/invoices/:id (Public)
invoicesRouter.get("/:id", async (req: Request, res: Response) => {
  const invoiceId = req.params.id;

  try {
    const resRow = await query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
    if (resRow.rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found.", details: null });
      return;
    }

    const invoice = resRow.rows[0];

    // Check expiration
    if (invoice.status === "pending" && new Date(invoice.expires_at).getTime() < Date.now()) {
      await query("UPDATE invoices SET status = 'expired' WHERE id = $1", [invoiceId]);
      invoice.status = "expired";
    }

    // Load election if apply_election is true
    let elections: any[] = [];
    if (invoice.apply_election) {
      const elecRes = await query(
        `SELECT asset_symbol, asset_mint, basis_points
         FROM elections
         WHERE tag = $1 AND is_active = true
         ORDER BY basis_points DESC`,
        [invoice.creator_tag],
      );
      elections = elecRes.rows.map((r) => ({
        symbol: r.asset_symbol,
        mint: r.asset_mint,
        basisPoints: r.basis_points,
        percentage: r.basis_points / 100,
      }));
    }

    res.status(200).json({
      id: invoice.id,
      creatorTag: invoice.creator_tag,
      recipientWallet: invoice.recipient_wallet,
      amount: invoice.amount,
      tokenSymbol: invoice.token_symbol,
      tokenMint: invoice.token_mint,
      memo: invoice.memo,
      applyElection: invoice.apply_election,
      election: elections,
      status: invoice.status,
      expiresAt: new Date(invoice.expires_at).toISOString(),
      createdAt: new Date(invoice.created_at).toISOString(),
      paidAt: invoice.paid_at ? new Date(invoice.paid_at).toISOString() : null,
      signature: invoice.signature,
    });
  } catch (err) {
    console.error("Get invoice error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to get invoice.", details: null });
  }
});

// POST /api/v1/invoices/:id/cancel [S]
invoicesRouter.post("/:id/cancel", requireSession, async (req: Request, res: Response) => {
  const invoiceId = req.params.id;
  const creatorTag = req.userTag!;

  try {
    const updateRes = await query(
      "UPDATE invoices SET status = 'cancelled' WHERE id = $1 AND creator_tag = $2 AND status = 'pending' RETURNING id",
      [invoiceId, creatorTag],
    );

    if (updateRes.rows.length === 0) {
      res.status(400).json({ error: "VALIDATION_FAILED", message: "Invoice cannot be cancelled.", details: null });
      return;
    }

    res.status(200).json({ status: "cancelled" });
  } catch (err) {
    console.error("Cancel invoice error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to cancel invoice.", details: null });
  }
});

// POST /api/v1/invoices/:id/confirm
invoicesRouter.post("/:id/confirm", async (req: Request, res: Response) => {
  const invoiceId = req.params.id;
  const { signature, payerWallet, payerTag } = req.body || {};

  if (!signature || !payerWallet) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "signature and payerWallet are required.", details: null });
    return;
  }

  try {
    const updateRes = await query(
      `UPDATE invoices
       SET status = 'paid', signature = $1, payer_wallet = $2, payer_tag = $3, paid_at = NOW()
       WHERE id = $4 AND status = 'pending'
       RETURNING id`,
      [signature, payerWallet, payerTag || null, invoiceId],
    );

    if (updateRes.rows.length === 0) {
      res.status(400).json({ error: "VALIDATION_FAILED", message: "Invoice is not in pending status.", details: null });
      return;
    }

    res.status(200).json({ status: "paid", signature });
  } catch (err) {
    console.error("Confirm invoice error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to confirm invoice.", details: null });
  }
});
