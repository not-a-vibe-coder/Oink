import { Router, type Request, type Response } from "express";
import { query } from "../db";
import { requireSession } from "../middleware/session";
import { getWalletBalances } from "../services/rpc";

export const walletRouter = Router();

// GET /api/v1/wallet [S]
walletRouter.get("/", requireSession, async (req: Request, res: Response) => {
  const accountId = req.accountId!;

  try {
    const walletRes = await query("SELECT public_key FROM wallets WHERE account_id = $1", [accountId]);
    if (walletRes.rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Wallet not found.", details: null });
      return;
    }

    const publicKey = walletRes.rows[0].public_key;
    const balances = await getWalletBalances(accountId, publicKey);

    res.status(200).json(balances);
  } catch (err) {
    console.error("Get wallet balances error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to fetch wallet balances.", details: null });
  }
});

// GET /api/v1/wallet/address [S]
walletRouter.get("/address", requireSession, async (req: Request, res: Response) => {
  const accountId = req.accountId!;

  try {
    const walletRes = await query("SELECT public_key FROM wallets WHERE account_id = $1", [accountId]);
    if (walletRes.rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Wallet not found.", details: null });
      return;
    }

    const publicKey = walletRes.rows[0].public_key;
    const solanaPayUri = `solana:${publicKey}`;
    const explorerUrl = `https://solscan.io/account/${publicKey}`;

    res.status(200).json({
      publicKey,
      solanaPayUri,
      explorerUrl,
    });
  } catch (err) {
    console.error("Get wallet address error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to get wallet address.", details: null });
  }
});
