import { Router, type Request, type Response } from "express";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { query } from "../db";
import { InvalidIdentityTokenError, PrivyNotConfiguredError, verifyIdentityToken } from "../lib/privy";
import {
  adminTokenHash,
  clearAdminCookie,
  createAdminSession,
  isAdminEmail,
  requireAdmin,
  serializeAdminCookie,
} from "../middleware/adminSession";
import { getClientIp, hashIp, ipRateLimiter } from "../middleware/rateLimit";
import { getFeePayerPublicKey } from "../services/feePayer";
import { getConnection } from "../services/rpc";

// The /admin dashboard's API (docs/12 §8). Read-only over user data: the only writes are
// admin sessions, review verdicts and the audit trail itself.
export const adminRouter = Router();

async function audit(req: Request, action: string, detail: Record<string, unknown> = {}) {
  await query("INSERT INTO admin_audit (admin_email, action, detail, ip_hash) VALUES ($1, $2, $3, $4)", [
    req.adminEmail,
    action,
    JSON.stringify(detail),
    hashIp(getClientIp(req)),
  ]);
}

function page(req: Request, max = 200) {
  const limit = Math.min(max, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
  return { limit, offset };
}

// ── Session ────────────────────────────────────────────────────────────────

// POST /api/v1/admin/login { identityToken } — a Privy email sign-in whose address is listed
// in ADMIN_EMAILS. Any other outcome gets the same answer.
adminRouter.post("/login", ipRateLimiter("admin_login", 10, 3600), async (req: Request, res: Response) => {
  const ipHash = hashIp(getClientIp(req));
  try {
    const identity = await verifyIdentityToken(req.body?.identityToken);
    if (!identity.email || !isAdminEmail(identity.email)) {
      await query("INSERT INTO login_attempts (account_id, ip_hash, kind, succeeded) VALUES (NULL, $1, 'admin_login', FALSE)", [ipHash]);
      res.status(403).json({ error: "FORBIDDEN", message: "That account doesn't have admin access.", details: null });
      return;
    }
    const { token, expiresAt } = await createAdminSession(identity.email, req.headers["user-agent"], ipHash);
    req.adminEmail = identity.email;
    await audit(req, "login");
    res.setHeader("Set-Cookie", serializeAdminCookie(token, expiresAt));
    res.status(200).json({ email: identity.email, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    if (err instanceof PrivyNotConfiguredError) {
      res.status(503).json({ error: "NOT_CONFIGURED", message: "Admin sign-in needs Privy to be configured.", details: null });
      return;
    }
    if (err instanceof InvalidIdentityTokenError) {
      res.status(401).json({ error: "INVALID_IDENTITY", message: "That sign-in didn't verify. Try again.", details: null });
      return;
    }
    console.error("Admin login error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Admin sign-in failed.", details: null });
  }
});

adminRouter.post("/logout", async (req: Request, res: Response) => {
  const tokenHash = adminTokenHash(req);
  if (tokenHash) await query("UPDATE admin_sessions SET revoked_at = NOW() WHERE token_hash = $1", [tokenHash]);
  res.setHeader("Set-Cookie", clearAdminCookie());
  res.status(204).end();
});

adminRouter.get("/me", requireAdmin, (req: Request, res: Response) => {
  res.status(200).json({ email: req.adminEmail });
});

// ── Overview ───────────────────────────────────────────────────────────────

adminRouter.get("/overview", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const counts = (
      await query(`SELECT
        (SELECT COUNT(*) FROM wallets)::int AS wallets,
        (SELECT COUNT(*) FROM wallets WHERE created_at > NOW() - INTERVAL '24 hours')::int AS wallets_24h,
        (SELECT COUNT(*) FROM wallets WHERE tag IS NOT NULL)::int AS tagged,
        (SELECT COUNT(*) FROM wallets WHERE email IS NOT NULL)::int AS emails_linked,
        (SELECT COUNT(*) FROM wallets WHERE x_user_id IS NOT NULL)::int AS x_linked,
        (SELECT COUNT(*) FROM transfers)::int AS transfers,
        (SELECT COUNT(*) FROM transfers WHERE created_at > NOW() - INTERVAL '24 hours')::int AS transfers_24h,
        (SELECT COUNT(*) FROM transfers WHERE status = 'failed')::int AS transfers_failed,
        (SELECT COUNT(*) FROM login_attempts WHERE NOT succeeded AND created_at > NOW() - INTERVAL '24 hours')::int AS failed_logins_24h,
        (SELECT COUNT(*) FROM admin_reviews WHERE status = 'flagged')::int AS flagged,
        (SELECT COUNT(*) FROM held_payments WHERE status IN ('held','claiming','refunding'))::int AS held_pending,
        (SELECT COUNT(*) FROM held_payments WHERE status = 'failed')::int AS held_failed,
        (SELECT COALESCE(SUM(lamports), 0) FROM fee_sponsorships WHERE day = CURRENT_DATE)::text AS sponsored_lamports_today`)
    ).rows[0];

    // The fee payer running dry stops every sponsored send, so it is the one number worth
    // an RPC call here. A failed lookup shows as unknown rather than failing the page.
    const feePayer = getFeePayerPublicKey();
    let feePayerSol: string | null = null;
    if (feePayer) {
      try {
        feePayerSol = ((await getConnection().getBalance(feePayer)) / LAMPORTS_PER_SOL).toFixed(4);
      } catch {
        feePayerSol = null;
      }
    }

    res.status(200).json({ ...counts, feePayer: feePayer?.toBase58() ?? null, feePayerSol });
  } catch (err) {
    console.error("Admin overview error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to load overview.", details: null });
  }
});

// ── Transactions ───────────────────────────────────────────────────────────

adminRouter.get("/transfers", requireAdmin, async (req: Request, res: Response) => {
  const { limit, offset } = page(req);
  const status = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
  const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim().toLowerCase() : null;
  try {
    const where = `WHERE ($1::text IS NULL OR t.status = $1)
      AND ($2::text IS NULL OR t.signature ILIKE '%' || $2 || '%' OR t.sender_wallet ILIKE '%' || $2 || '%'
        OR t.recipient_wallet ILIKE '%' || $2 || '%' OR s.tag = $2 OR r.tag = $2
        OR t.sender_account_id = $2 OR t.recipient_account_id = $2)`;
    const joins = `LEFT JOIN wallets s ON s.account_id = t.sender_account_id
      LEFT JOIN wallets r ON r.account_id = t.recipient_account_id
      LEFT JOIN admin_reviews v ON v.source = 'transfer' AND v.source_id = t.id`;
    const total = (await query(`SELECT COUNT(*)::int AS n FROM transfers t ${joins} ${where}`, [status, q])).rows[0].n;
    const rows = await query(
      `SELECT t.id, t.signature, t.direction, t.source, t.status, t.input_symbol, t.input_amount, t.output_breakdown,
              t.mix_applied, t.fee_sponsored, t.sender_account_id, s.tag AS sender_tag, t.sender_wallet,
              t.recipient_account_id, r.tag AS recipient_tag, t.recipient_wallet, t.created_at, t.confirmed_at,
              v.status AS review_status, v.note AS review_note
       FROM transfers t ${joins} ${where}
       ORDER BY t.created_at DESC LIMIT $3 OFFSET $4`,
      [status, q, limit, offset],
    );
    res.status(200).json({ transfers: rows.rows, total, limit, offset });
  } catch (err) {
    console.error("Admin transfers error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to load transfers.", details: null });
  }
});

// ── Activity ───────────────────────────────────────────────────────────────

// Account events and login attempts in one feed. `filter` narrows to items that failed,
// were flagged, or have not been looked at yet.
adminRouter.get("/activity", requireAdmin, async (req: Request, res: Response) => {
  const { limit, offset } = page(req);
  const filter = String(req.query.filter ?? "all");
  const conditions: Record<string, string> = {
    all: "TRUE",
    unreviewed: "v.status IS NULL",
    flagged: "v.status = 'flagged'",
    failures: "x.succeeded = FALSE",
  };
  const condition = conditions[filter] ?? "TRUE";
  try {
    const feed = `(
      SELECT 'event'::text AS source, e.id, e.account_id, e.kind, e.detail, e.ip_hash, NULL::boolean AS succeeded, e.created_at
      FROM account_events e
      UNION ALL
      SELECT 'login'::text, a.id, a.account_id, a.kind, '{}'::jsonb, a.ip_hash, a.succeeded, a.created_at
      FROM login_attempts a
    ) x LEFT JOIN admin_reviews v ON v.source = x.source AND v.source_id = x.id
        LEFT JOIN wallets w ON w.account_id = x.account_id`;
    const total = (await query(`SELECT COUNT(*)::int AS n FROM ${feed} WHERE ${condition}`)).rows[0].n;
    const rows = await query(
      `SELECT x.source, x.id, x.account_id, w.tag, x.kind, x.detail, LEFT(x.ip_hash, 8) AS ip, x.succeeded, x.created_at,
              v.status AS review_status, v.note AS review_note, v.admin_email AS reviewed_by
       FROM ${feed} WHERE ${condition}
       ORDER BY x.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    res.status(200).json({ items: rows.rows, total, limit, offset });
  } catch (err) {
    console.error("Admin activity error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to load activity.", details: null });
  }
});

// POST /api/v1/admin/reviews { source, sourceId, status: reviewed|flagged|clear, note? }
adminRouter.post("/reviews", requireAdmin, async (req: Request, res: Response) => {
  const { source, sourceId, status, note } = req.body || {};
  const id = Number(sourceId);
  if (!["event", "login", "transfer", "held"].includes(source) || !Number.isSafeInteger(id) || !["reviewed", "flagged", "clear"].includes(status)) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "Invalid review.", details: null });
    return;
  }
  const cleanNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null;
  try {
    if (status === "clear") {
      await query("DELETE FROM admin_reviews WHERE source = $1 AND source_id = $2", [source, id]);
    } else {
      await query(
        `INSERT INTO admin_reviews (source, source_id, status, note, admin_email) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source, source_id) DO UPDATE SET status = $3, note = $4, admin_email = $5, updated_at = NOW()`,
        [source, id, status, cleanNote, req.adminEmail],
      );
    }
    await audit(req, "review", { source, sourceId: id, status });
    res.status(200).json({ source, sourceId: id, status });
  } catch (err) {
    console.error("Admin review error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to save review.", details: null });
  }
});

// ── Held payments ──────────────────────────────────────────────────────────

adminRouter.get("/held", requireAdmin, async (req: Request, res: Response) => {
  const { limit, offset } = page(req);
  const status = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
  try {
    const total = (await query("SELECT COUNT(*)::int AS n FROM held_payments WHERE ($1::text IS NULL OR status = $1)", [status])).rows[0].n;
    const rows = await query(
      `SELECT hp.id, hp.recipient_kind, hp.recipient_display, hp.symbol, hp.decimals, hp.amount_base::text AS amount_base,
              hp.status, hp.attempts, hp.last_error, hp.expires_at, hp.released_at, hp.created_at, hp.notified_at,
              hp.deposit_signature, hp.release_signature, hp.sender_account_id, s.tag AS sender_tag,
              hp.claimant_account_id, c.tag AS claimant_tag, hw.address AS holding_wallet
       FROM held_payments hp
       JOIN held_wallets hw ON hw.id = hp.held_wallet_id
       LEFT JOIN wallets s ON s.account_id = hp.sender_account_id
       LEFT JOIN wallets c ON c.account_id = hp.claimant_account_id
       WHERE ($1::text IS NULL OR hp.status = $1)
       ORDER BY hp.created_at DESC LIMIT $2 OFFSET $3`,
      [status, limit, offset],
    );
    const pending = (
      await query(
        `SELECT symbol, COUNT(*)::int AS payments, SUM(amount_base)::text AS amount_base, MAX(decimals) AS decimals
         FROM held_payments WHERE status IN ('held','claiming','refunding') GROUP BY symbol`,
      )
    ).rows;
    res.status(200).json({ held: rows.rows, pending, total, limit, offset });
  } catch (err) {
    console.error("Admin held error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to load held payments.", details: null });
  }
});

// POST /api/v1/admin/held/:id/retry — a failed release goes back to `held`, and the worker
// claims or refunds it on its next round depending on whether it has expired.
adminRouter.post("/held/:id/retry", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "Invalid id.", details: null });
    return;
  }
  try {
    const row = (
      await query(
        `UPDATE held_payments SET status = 'held', attempts = 0, claimant_account_id = NULL, last_error = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'failed' RETURNING id`,
        [id],
      )
    ).rows[0];
    if (!row) {
      res.status(409).json({ error: "VALIDATION_FAILED", message: "Only a failed payment can be retried.", details: null });
      return;
    }
    await audit(req, "held_retry", { heldPaymentId: id });
    res.status(200).json({ id, status: "held" });
  } catch (err) {
    console.error("Admin held retry error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to retry.", details: null });
  }
});

// ── Database viewer ────────────────────────────────────────────────────────

// Only these tables, and never these columns. Columns are chosen by what they are, not by
// table, so a secret column added later to any of these tables is hidden if it reuses a
// name here — anything new that is sensitive must be added to this list.
export const VIEWABLE_TABLES = [
  "wallets",
  "mixes",
  "mix_revisions",
  "transfers",
  "invoices",
  "fee_sponsorships",
  "sessions",
  "login_attempts",
  "auth_challenges",
  "enrollments",
  "account_events",
  "admin_reviews",
  "admin_audit",
  "admin_sessions",
  "held_wallets",
  "held_payments",
] as const;

export const HIDDEN_COLUMNS = new Set([
  "ciphertext",
  "nonce",
  "kdf_salt",
  "kdf_params",
  "auth_key_hash",
  "totp_secret_enc",
  "totp_nonce",
  "token_hash",
  "sign_message",
]);

adminRouter.get("/tables", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT relname AS name, n_live_tup::int AS approx_rows FROM pg_stat_user_tables WHERE relname = ANY($1) ORDER BY relname`,
      [VIEWABLE_TABLES as unknown as string[]],
    );
    res.status(200).json({ tables: rows.rows });
  } catch (err) {
    console.error("Admin tables error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to list tables.", details: null });
  }
});

adminRouter.get("/tables/:name", requireAdmin, async (req: Request, res: Response) => {
  const name = req.params.name;
  if (!(VIEWABLE_TABLES as readonly string[]).includes(name)) {
    res.status(404).json({ error: "NOT_FOUND", message: "No such table.", details: null });
    return;
  }
  const { limit, offset } = page(req, 100);
  try {
    const columns = (
      await query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [name],
      )
    ).rows
      .map((r) => r.column_name as string)
      .filter((column) => !HIDDEN_COLUMNS.has(column));
    const hidden = (
      await query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [name],
      )
    ).rows
      .map((r) => r.column_name as string)
      .filter((column) => HIDDEN_COLUMNS.has(column));

    const orderBy = columns.includes("created_at") ? `"created_at" DESC` : "1";
    const select = columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(", ");
    const total = (await query(`SELECT COUNT(*)::int AS n FROM "${name}"`)).rows[0].n;
    const rows = await query(`SELECT ${select} FROM "${name}" ORDER BY ${orderBy} LIMIT $1 OFFSET $2`, [limit, offset]);

    await audit(req, "table_read", { table: name, offset });
    res.status(200).json({ table: name, columns, hiddenColumns: hidden, rows: rows.rows, total, limit, offset });
  } catch (err) {
    console.error("Admin table read error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to read table.", details: null });
  }
});
