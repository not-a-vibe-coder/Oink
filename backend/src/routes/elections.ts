import { Router, type Request, type Response } from "express";
import { pool, query } from "../db";
import { normalizeTag } from "../lib/tagRules";
import { resolveSolanaToken } from "../lib/tokens";
import { requireSession } from "../middleware/session";

export const electionsRouter = Router();

// GET /api/v1/elections/:tag
electionsRouter.get("/:tag", async (req: Request, res: Response) => {
  const tag = normalizeTag(req.params.tag);

  try {
    const rows = await query(
      `SELECT asset_symbol, asset_mint, decimals, basis_points
       FROM elections
       WHERE tag = $1 AND is_active = true
       ORDER BY basis_points DESC`,
      [tag],
    );

    const elections = rows.rows.map((r) => ({
      symbol: r.asset_symbol,
      mint: r.asset_mint,
      decimals: r.decimals,
      basisPoints: r.basis_points,
      percentage: r.basis_points / 100,
    }));

    res.status(200).json({ elections });
  } catch (err) {
    console.error("Get elections error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to get elections.", details: null });
  }
});

// PUT /api/v1/elections [S]
electionsRouter.put("/", requireSession, async (req: Request, res: Response) => {
  const { elections } = req.body || {};
  const tag = req.userTag!;

  if (!Array.isArray(elections) || elections.length === 0 || elections.length > 10) {
    res.status(400).json({
      error: "ELECTION_INVALID",
      message: "Elections must contain between 1 and 10 assets.",
      details: null,
    });
    return;
  }

  let totalBps = 0;
  const seenMints = new Set<string>();

  for (const item of elections) {
    if (!item.mint || typeof item.basisPoints !== "number" || item.basisPoints <= 0 || item.basisPoints > 10000) {
      res.status(400).json({
        error: "ELECTION_INVALID",
        message: "Each election must have a valid mint and basis points between 1 and 10000.",
        details: null,
      });
      return;
    }

    if (seenMints.has(item.mint)) {
      res.status(400).json({
        error: "ELECTION_INVALID",
        message: "Duplicate assets are not allowed in an election.",
        details: null,
      });
      return;
    }
    seenMints.add(item.mint);

    const resolved = resolveSolanaToken(item.mint);
    if (!resolved) {
      res.status(400).json({
        error: "ELECTION_INVALID",
        message: `Unknown asset in election: ${item.mint}`,
        details: null,
      });
      return;
    }

    totalBps += item.basisPoints;
  }

  if (totalBps !== 10000) {
    res.status(400).json({
      error: "ELECTION_INVALID",
      message: `Election allocations must sum to exactly 10000 basis points (100%). Current sum is ${totalBps} bps (${(totalBps / 100).toFixed(1)}%).`,
      details: null,
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Deactivate old elections
    await client.query(
      "UPDATE elections SET is_active = false, updated_at = NOW() WHERE tag = $1 AND is_active = true",
      [tag],
    );

    // 2. Insert new elections
    const now = new Date();
    for (const item of elections) {
      const resolved = resolveSolanaToken(item.mint)!;
      await client.query(
        `INSERT INTO elections (tag, asset_symbol, asset_mint, decimals, basis_points, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, $6, $6)`,
        [tag, resolved.symbol, resolved.mint, resolved.decimals, item.basisPoints, now],
      );
    }

    // 3. Insert election_revisions audit
    const revRes = await client.query(
      `INSERT INTO election_revisions (tag, snapshot, created_at)
       VALUES ($1, $2, NOW())
       RETURNING id`,
      [tag, JSON.stringify(elections)],
    );

    await client.query("COMMIT");

    res.status(200).json({
      elections: elections.map((e) => ({
        ...e,
        percentage: e.basisPoints / 100,
      })),
      revisionId: revRes.rows[0]?.id,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Save elections error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to update elections.", details: null });
  } finally {
    client.release();
  }
});
