import { Router, type Request, type Response } from "express";
import { query } from "../db";
import { requireSession } from "../middleware/session";

// Held payments from the wallet's point of view: the ones it sent that are still waiting,
// and the ones waiting for an email or X account it has linked.
export const heldRouter = Router();

const COLUMNS = `id, recipient_kind, recipient_display, symbol, decimals, amount_base::text AS amount_base, status,
  expires_at, released_at, deposit_signature, release_signature, created_at`;

// GET /api/v1/held [S]
heldRouter.get("/", requireSession, async (req: Request, res: Response) => {
  const accountId = req.accountId!;
  try {
    const sent = await query(
      `SELECT ${COLUMNS} FROM held_payments WHERE sender_account_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [accountId],
    );
    const incoming = await query(
      `SELECT hp.id, hp.recipient_display, hp.symbol, hp.decimals, hp.amount_base::text AS amount_base, hp.status,
              hp.expires_at, hp.created_at, s.tag AS sender_tag
       FROM held_payments hp
       JOIN wallets me ON me.account_id = $1
       LEFT JOIN wallets s ON s.account_id = hp.sender_account_id
       WHERE hp.status IN ('held', 'claiming')
         AND ((hp.recipient_kind = 'email' AND hp.recipient_value = me.email)
           OR (hp.recipient_kind = 'x' AND hp.recipient_value = me.x_user_id))
       ORDER BY hp.created_at DESC`,
      [accountId],
    );
    res.status(200).json({ sent: sent.rows, incoming: incoming.rows });
  } catch (err) {
    console.error("Held list error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to load held payments.", details: null });
  }
});
