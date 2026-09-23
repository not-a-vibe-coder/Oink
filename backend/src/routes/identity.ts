import { Router, type Request, type Response } from "express";
import { pool, query } from "../db";
import { recordEvent } from "../lib/events";
import {
  InvalidIdentityTokenError,
  PrivyNotConfiguredError,
  privyConfigured,
  verifyIdentityToken,
  type VerifiedIdentity,
} from "../lib/privy";
import { validateTag } from "../lib/tagRules";
import { getClientIp, hashIp, ipRateLimiter } from "../middleware/rateLimit";
import { requireSession } from "../middleware/session";

// Linking an email or an X account to a wallet (docs/12 §3, §4). The browser proves the
// identity with Privy and passes the identity token; the session says which wallet.
export const identityRouter = Router();

async function identityState(accountId: string) {
  const row = (
    await query(
      `SELECT tag, email, email_linked_at, x_username, x_linked_at FROM wallets WHERE account_id = $1`,
      [accountId],
    )
  ).rows[0];
  return {
    configured: privyConfigured(),
    tag: row?.tag ?? null,
    email: row?.email ?? null,
    emailLinkedAt: row?.email_linked_at ?? null,
    x: row?.x_username ? { username: row.x_username, linkedAt: row.x_linked_at } : null,
  };
}

async function verifyOrRespond(req: Request, res: Response): Promise<VerifiedIdentity | null> {
  try {
    return await verifyIdentityToken(req.body?.identityToken);
  } catch (err) {
    if (err instanceof PrivyNotConfiguredError) {
      res.status(503).json({ error: "NOT_CONFIGURED", message: "Linking isn't switched on yet.", details: null });
    } else if (err instanceof InvalidIdentityTokenError) {
      res.status(401).json({ error: "INVALID_IDENTITY", message: "That sign-in didn't verify. Try again.", details: null });
    } else {
      throw err;
    }
    return null;
  }
}

// GET /api/v1/identity [S]
identityRouter.get("/", requireSession, async (req: Request, res: Response) => {
  try {
    res.status(200).json(await identityState(req.accountId!));
  } catch (err) {
    console.error("Identity state error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to load linked accounts.", details: null });
  }
});

// POST /api/v1/identity/email [S] { identityToken }
identityRouter.post("/email", requireSession, ipRateLimiter("identity_link", 20, 3600), async (req, res) => {
  const accountId = req.accountId!;
  const ipHash = hashIp(getClientIp(req));
  const identity = await verifyOrRespond(req, res);
  if (!identity) return;
  if (!identity.email) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "That sign-in didn't include an email.", details: null });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const holder = await client.query("SELECT account_id FROM wallets WHERE email = $1 FOR UPDATE", [identity.email]);
    if (holder.rows.length > 0 && holder.rows[0].account_id !== accountId) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: "EMAIL_TAKEN",
        message: "That email is linked to another Oink account. Unlink it there first.",
        details: null,
      });
      return;
    }
    await client.query("UPDATE wallets SET email = $1, email_linked_at = NOW(), updated_at = NOW() WHERE account_id = $2", [
      identity.email,
      accountId,
    ]);
    await recordEvent(accountId, "email_linked", { email: identity.email }, ipHash, client);
    await client.query("COMMIT");
    res.status(200).json(await identityState(accountId));
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err?.code === "23505") {
      res.status(409).json({ error: "EMAIL_TAKEN", message: "That email is linked to another Oink account.", details: null });
      return;
    }
    console.error("Link email error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to link email.", details: null });
  } finally {
    client.release();
  }
});

// DELETE /api/v1/identity/email [S]
identityRouter.delete("/email", requireSession, async (req: Request, res: Response) => {
  const accountId = req.accountId!;
  try {
    const cleared = await query(
      "UPDATE wallets SET email = NULL, email_linked_at = NULL, updated_at = NOW() WHERE account_id = $1 AND email IS NOT NULL RETURNING 1",
      [accountId],
    );
    if (cleared.rows.length > 0) await recordEvent(accountId, "email_unlinked", {}, hashIp(getClientIp(req)));
    res.status(200).json(await identityState(accountId));
  } catch (err) {
    console.error("Unlink email error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to unlink email.", details: null });
  }
});

// POST /api/v1/identity/x [S] { identityToken }
// Linking X also claims the tag: the X username, lowercased. The tag is bound to the X user
// ID, so if another wallet holds it without owning that X account, it moves here (docs/12 §3).
identityRouter.post("/x", requireSession, ipRateLimiter("identity_link", 20, 3600), async (req, res) => {
  const accountId = req.accountId!;
  const ipHash = hashIp(getClientIp(req));
  const identity = await verifyOrRespond(req, res);
  if (!identity) return;
  if (!identity.x) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "That sign-in didn't include an X account.", details: null });
    return;
  }
  const { userId, username } = identity.x;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const other = await client.query(
      "SELECT account_id FROM wallets WHERE x_user_id = $1 AND account_id <> $2 FOR UPDATE",
      [userId, accountId],
    );
    if (other.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: "X_TAKEN",
        message: "That X account is linked to another Oink account. Unlink it there first.",
        details: null,
      });
      return;
    }

    await client.query(
      "UPDATE wallets SET x_user_id = $1, x_username = $2, x_linked_at = NOW(), updated_at = NOW() WHERE account_id = $3",
      [userId, username, accountId],
    );
    await recordEvent(accountId, "x_linked", { username }, ipHash, client);

    // Short or reserved handles link fine but carry no tag; the user keeps any tag they had.
    const candidate = validateTag(username);
    let tagOutcome: "assigned" | "kept" | "invalid" | "reserved" = "kept";
    if (!candidate.valid) {
      tagOutcome = candidate.reason === "reserved" ? "reserved" : "invalid";
    } else {
      const holder = await client.query("SELECT account_id FROM wallets WHERE tag = $1 FOR UPDATE", [candidate.tag]);
      const heldBy: string | undefined = holder.rows[0]?.account_id;
      if (heldBy !== accountId) {
        if (heldBy) {
          await client.query("UPDATE wallets SET tag = NULL, updated_at = NOW() WHERE account_id = $1", [heldBy]);
          await recordEvent(heldBy, "tag_lost", { tag: candidate.tag, reason: "claimed_by_x_owner" }, null, client);
        }
        await client.query("UPDATE wallets SET tag = $1, updated_at = NOW() WHERE account_id = $2", [candidate.tag, accountId]);
        await recordEvent(accountId, "tag_assigned", { tag: candidate.tag, via: "x" }, ipHash, client);
        tagOutcome = "assigned";
      }
    }

    await client.query("COMMIT");
    res.status(200).json({ ...(await identityState(accountId)), tagOutcome });
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err?.code === "23505") {
      res.status(409).json({ error: "X_TAKEN", message: "That X account is linked to another Oink account.", details: null });
      return;
    }
    console.error("Link X error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to link X.", details: null });
  } finally {
    client.release();
  }
});

// DELETE /api/v1/identity/x [S] — the tag stays; it only moves if another X owner proves it.
identityRouter.delete("/x", requireSession, async (req: Request, res: Response) => {
  const accountId = req.accountId!;
  try {
    const cleared = await query(
      `UPDATE wallets SET x_user_id = NULL, x_username = NULL, x_linked_at = NULL, updated_at = NOW()
       WHERE account_id = $1 AND x_user_id IS NOT NULL RETURNING 1`,
      [accountId],
    );
    if (cleared.rows.length > 0) await recordEvent(accountId, "x_unlinked", {}, hashIp(getClientIp(req)));
    res.status(200).json(await identityState(accountId));
  } catch (err) {
    console.error("Unlink X error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to unlink X.", details: null });
  }
});
