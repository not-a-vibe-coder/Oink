import { Router, type Request, type Response } from "express";
import { query } from "../db";
import { identifierLookup, parseIdentifier } from "../lib/accountId";
import { normalizeTag } from "../lib/tagRules";
import { requireSession } from "../middleware/session";

// Tags are no longer chosen, so there is no availability check: a tag is assigned from the
// user's X username when they link X (docs/12 §3).
export const tagsRouter = Router();

// GET /api/v1/tags/resolve?q=... [S] — prefix search for the send screen
tagsRouter.get("/resolve", requireSession, async (req: Request, res: Response) => {
  const q = normalizeTag((req.query.q as string) || "");
  if (!q || !/^[a-z0-9_]+$/.test(q)) {
    res.status(200).json({ results: [] });
    return;
  }

  try {
    const result = await query(
      `SELECT account_id, tag, display_name, avatar_seed
       FROM wallets
       WHERE tag LIKE $1 AND status = 'active'
       ORDER BY tag ASC
       LIMIT 8`,
      [`${q}%`],
    );

    const results = result.rows.map((row) => ({
      accountId: row.account_id,
      tag: row.tag,
      displayName: row.display_name || row.tag,
      avatarSeed: row.avatar_seed || row.tag,
    }));

    res.status(200).json({ results });
  } catch (err) {
    console.error("Tag resolve error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to resolve tags.", details: null });
  }
});

// GET /api/v1/tags/:identifier — public profile by tag or account ID
tagsRouter.get("/:identifier", async (req: Request, res: Response) => {
  const id = parseIdentifier(req.params.identifier);
  if (!id) {
    res.status(404).json({ error: "NOT_FOUND", message: "Account not found.", details: null });
    return;
  }
  const lookup = identifierLookup(id);

  try {
    const walletRes = await query(
      `SELECT account_id, tag, public_key, display_name, avatar_seed, created_at
       FROM wallets
       WHERE ${lookup.where} AND status = 'active'`,
      [lookup.value],
    );

    if (walletRes.rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Account not found.", details: null });
      return;
    }

    const wallet = walletRes.rows[0];

    const mixRes = await query(
      `SELECT asset_symbol, asset_mint, basis_points
       FROM mixes
       WHERE account_id = $1 AND is_active = true
       ORDER BY basis_points DESC`,
      [wallet.account_id],
    );
    const mix = mixRes.rows.map((r) => ({
      symbol: r.asset_symbol,
      mint: r.asset_mint,
      basisPoints: r.basis_points,
      percentage: r.basis_points / 100,
    }));

    res.status(200).json({
      accountId: wallet.account_id,
      tag: wallet.tag,
      publicKey: wallet.public_key,
      displayName: wallet.display_name || wallet.tag || wallet.account_id,
      avatarSeed: wallet.avatar_seed || wallet.tag || wallet.account_id,
      acceptsMix: true,
      mix,
      createdAt: new Date(wallet.created_at).toISOString(),
    });
  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to get profile.", details: null });
  }
});
