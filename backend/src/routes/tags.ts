import { Router, type Request, type Response } from "express";
import { query } from "../db";
import { normalizeTag, validateTag } from "../lib/tagRules";
import { ipRateLimiter } from "../middleware/rateLimit";
import { requireSession } from "../middleware/session";

export const tagsRouter = Router();

// GET /api/v1/tags/:tag/availability
// Rate limit: 60/minute/IP
tagsRouter.get(
  "/:tag/availability",
  ipRateLimiter("tag_availability", 60, 60),
  async (req: Request, res: Response) => {
    const rawTag = req.params.tag;
    const { valid, reason, tag } = validateTag(rawTag);

    if (!valid) {
      res.status(200).json({ tag, available: false, reason });
      return;
    }

    try {
      const result = await query("SELECT tag FROM wallets WHERE tag = $1", [tag]);
      if (result.rows.length > 0) {
        res.status(200).json({ tag, available: false, reason: "taken" });
        return;
      }

      res.status(200).json({ tag, available: true, reason: null });
    } catch (err) {
      console.error("Tag availability error:", err);
      res.status(500).json({ error: "INTERNAL", message: "Failed to check tag availability.", details: null });
    }
  },
);

// GET /api/v1/tags/resolve?q=... [S]
tagsRouter.get("/resolve", requireSession, async (req: Request, res: Response) => {
  const q = normalizeTag((req.query.q as string) || "");
  if (!q) {
    res.status(200).json({ results: [] });
    return;
  }

  try {
    const result = await query(
      `SELECT tag, display_name, avatar_seed
       FROM wallets
       WHERE tag LIKE $1 AND status = 'active'
       ORDER BY tag ASC
       LIMIT 8`,
      [`${q}%`],
    );

    const results = result.rows.map((row) => ({
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

// GET /api/v1/tags/:tag
tagsRouter.get("/:tag", async (req: Request, res: Response) => {
  const tag = normalizeTag(req.params.tag);

  try {
    const walletRes = await query(
      `SELECT tag, public_key, display_name, avatar_seed, created_at
       FROM wallets
       WHERE tag = $1 AND status = 'active'`,
      [tag],
    );

    if (walletRes.rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tag not found.", details: null });
      return;
    }

    const wallet = walletRes.rows[0];

    // Load elections
    let elections: Array<{ symbol: string; mint: string; basisPoints: number; percentage: number }> = [];
    try {
      const elecRes = await query(
        `SELECT asset_symbol, asset_mint, basis_points
         FROM elections
         WHERE tag = $1 AND is_active = true
         ORDER BY basis_points DESC`,
        [tag],
      );
      elections = elecRes.rows.map((r) => ({
        symbol: r.asset_symbol,
        mint: r.asset_mint,
        basisPoints: r.basis_points,
        percentage: r.basis_points / 100,
      }));
    } catch {
      // If elections table not yet populated, fallback to 100% USDC
      elections = [
        {
          symbol: "USDC",
          mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          basisPoints: 10000,
          percentage: 100,
        },
      ];
    }

    res.status(200).json({
      tag: wallet.tag,
      publicKey: wallet.public_key,
      displayName: wallet.display_name || wallet.tag,
      avatarSeed: wallet.avatar_seed || wallet.tag,
      acceptsElection: true,
      election: elections,
      createdAt: new Date(wallet.created_at).toISOString(),
    });
  } catch (err) {
    console.error("Get tag profile error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to get tag profile.", details: null });
  }
});
