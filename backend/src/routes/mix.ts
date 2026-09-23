import { Router, type Request, type Response } from "express";
import { pool, query } from "../db";
import { identifierLookup, parseIdentifier } from "../lib/accountId";
import { resolveSolanaToken } from "../lib/tokens";
import { requireSession } from "../middleware/session";

export const mixRouter = Router();

// GET /api/v1/mix/:identifier — public, because a payer previews the recipient's mix.
mixRouter.get("/:identifier", async (req: Request, res: Response) => {
  const id = parseIdentifier(req.params.identifier);
  if (!id) {
    res.status(404).json({ error: "NOT_FOUND", message: "Account not found.", details: null });
    return;
  }
  const lookup = identifierLookup(id);

  try {
    const rows = await query(
      `SELECT m.asset_symbol, m.asset_mint, m.decimals, m.basis_points
       FROM mixes m
       JOIN wallets w ON w.account_id = m.account_id
       WHERE w.${lookup.where} AND m.is_active = true
       ORDER BY m.basis_points DESC`,
      [lookup.value],
    );

    const mix = rows.rows.map((r) => ({
      symbol: r.asset_symbol,
      mint: r.asset_mint,
      decimals: r.decimals,
      basisPoints: r.basis_points,
      percentage: r.basis_points / 100,
    }));

    res.status(200).json({ mix });
  } catch (err) {
    console.error("Get mix error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to get mix.", details: null });
  }
});

// PUT /api/v1/mix [S]
mixRouter.put("/", requireSession, async (req: Request, res: Response) => {
  const { mix } = req.body || {};
  const accountId = req.accountId!;

  if (!Array.isArray(mix) || mix.length === 0 || mix.length > 10) {
    res.status(400).json({
      error: "MIX_INVALID",
      message: "A mix must contain between 1 and 10 assets.",
      details: null,
    });
    return;
  }

  let totalBps = 0;
  const seenMints = new Set<string>();

  for (const item of mix) {
    if (!item.mint || !Number.isInteger(item.basisPoints) || item.basisPoints <= 0 || item.basisPoints > 10000) {
      res.status(400).json({
        error: "MIX_INVALID",
        message: "Each asset in a mix needs a valid mint and whole basis points between 1 and 10000.",
        details: null,
      });
      return;
    }

    if (seenMints.has(item.mint)) {
      res.status(400).json({
        error: "MIX_INVALID",
        message: "Duplicate assets are not allowed in a mix.",
        details: null,
      });
      return;
    }
    seenMints.add(item.mint);

    const resolved = resolveSolanaToken(item.mint);
    if (!resolved) {
      res.status(400).json({
        error: "MIX_INVALID",
        message: `Unknown asset in mix: ${item.mint}`,
        details: null,
      });
      return;
    }

    totalBps += item.basisPoints;
  }

  if (totalBps !== 10000) {
    res.status(400).json({
      error: "MIX_INVALID",
      message: `Mix allocations must sum to exactly 10000 basis points (100%). Current sum is ${totalBps} bps (${(totalBps / 100).toFixed(1)}%).`,
      details: null,
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      "UPDATE mixes SET is_active = false, updated_at = NOW() WHERE account_id = $1 AND is_active = true",
      [accountId],
    );

    const now = new Date();
    for (const item of mix) {
      const resolved = resolveSolanaToken(item.mint)!;
      await client.query(
        `INSERT INTO mixes (account_id, asset_symbol, asset_mint, decimals, basis_points, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, $6, $6)`,
        [accountId, resolved.symbol, resolved.mint, resolved.decimals, item.basisPoints, now],
      );
    }

    const revRes = await client.query(
      `INSERT INTO mix_revisions (account_id, snapshot, created_at)
       VALUES ($1, $2, NOW())
       RETURNING id`,
      [accountId, JSON.stringify(mix)],
    );

    await client.query("COMMIT");

    res.status(200).json({
      mix: mix.map((e) => ({
        ...e,
        percentage: e.basisPoints / 100,
      })),
      revisionId: revRes.rows[0]?.id,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Save mix error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to update mix.", details: null });
  } finally {
    client.release();
  }
});
