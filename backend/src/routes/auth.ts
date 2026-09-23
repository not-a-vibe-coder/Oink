import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import { pool, query } from "../db";
import { generateDecoyChallenge, decryptKms, encryptKms } from "../lib/crypto";
import { verifyTotp, generateTotpSecret, formatOtpauthUri } from "../lib/totp";
import { verifyAuthKey, hashAuthKey, dummyArgonVerify } from "../lib/argon";
import { verifySolanaSignature } from "../lib/verifySignature";
import { normalizeTag } from "../lib/tagRules";
import {
  hashIp,
  getClientIp,
  recordLoginAttempt,
  checkTagLockout,
  ipRateLimiter,
} from "../middleware/rateLimit";
import {
  requireSession,
  createSession,
  serializeSessionCookie,
  clearSessionCookie,
} from "../middleware/session";

export const authRouter = Router();

// POST /api/v1/auth/challenge
// Rate limit: 20/hour/IP
authRouter.post("/challenge", ipRateLimiter("challenge", 20, 3600), async (req: Request, res: Response) => {
  const { tag } = req.body || {};
  if (!tag || typeof tag !== "string") {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "tag is required.", details: null });
    return;
  }

  const normalizedTag = normalizeTag(tag);
  const ipHash = hashIp(getClientIp(req));
  const challengeId = `chl_${nanoid(24)}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min TTL

  try {
    const result = await query(
      `SELECT tag, kdf_salt, kdf_params, ciphertext, nonce, cipher, keystore_version, status
       FROM wallets
       WHERE tag = $1`,
      [normalizedTag],
    );

    if (result.rows.length === 0 || result.rows[0].status === "frozen") {
      // Deterministic decoy for unknown tags or frozen accounts
      const decoy = generateDecoyChallenge(normalizedTag);

      await query(
        `INSERT INTO auth_challenges (id, purpose, tag, is_decoy, ip_hash, expires_at, created_at)
         VALUES ($1, 'unlock', NULL, TRUE, $2, $3, NOW())`,
        [challengeId, ipHash, expiresAt],
      );

      res.status(200).json({
        challengeId,
        kdfSalt: decoy.kdfSalt,
        kdfParams: decoy.kdfParams,
        keystore: decoy.keystore,
        requiresTotp: true,
      });
      return;
    }

    const wallet = result.rows[0];

    await query(
      `INSERT INTO auth_challenges (id, purpose, tag, is_decoy, ip_hash, expires_at, created_at)
       VALUES ($1, 'unlock', $2, FALSE, $3, $4, NOW())`,
      [challengeId, normalizedTag, ipHash, expiresAt],
    );

    res.status(200).json({
      challengeId,
      kdfSalt: wallet.kdf_salt,
      kdfParams: typeof wallet.kdf_params === "string" ? JSON.parse(wallet.kdf_params) : wallet.kdf_params,
      keystore: {
        ciphertext: wallet.ciphertext,
        nonce: wallet.nonce,
        cipher: wallet.cipher,
        version: wallet.keystore_version,
      },
      requiresTotp: true,
    });
  } catch (err) {
    console.error("Auth challenge error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to create authentication challenge.", details: null });
  }
});

// POST /api/v1/auth/unlock
authRouter.post("/unlock", ipRateLimiter("unlock", 30, 3600), async (req: Request, res: Response) => {
  const { challengeId, authKey, totpCode } = req.body || {};
  const ipHash = hashIp(getClientIp(req));

  if (!challengeId || !authKey || !totpCode) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "challengeId, authKey, and totpCode are required.", details: null });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Single-use challenge consumption
    const chalResult = await client.query(
      `UPDATE auth_challenges
       SET consumed_at = NOW()
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > NOW()
       RETURNING tag, is_decoy`,
      [challengeId],
    );

    if (chalResult.rows.length === 0) {
      await client.query("ROLLBACK");
      await dummyArgonVerify(authKey);
      await recordLoginAttempt(null, ipHash, "unlock", false);
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    const challenge = chalResult.rows[0];

    if (challenge.is_decoy || !challenge.tag) {
      await client.query("COMMIT");
      await dummyArgonVerify(authKey);
      await recordLoginAttempt(null, ipHash, "unlock", false);
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    const tag = challenge.tag;

    // Check lockout ladder for tag
    const lockout = await checkTagLockout(tag);
    if (lockout.locked) {
      await client.query("ROLLBACK");
      await dummyArgonVerify(authKey);
      res.setHeader("Retry-After", lockout.retryAfterSeconds?.toString() || "60");
      res.status(429).json({
        error: "RATE_LIMITED",
        message: `Account is temporarily locked due to failed attempts. Try again in ${lockout.retryAfterSeconds}s.`,
        details: null,
      });
      return;
    }

    // Load wallet
    const walletRes = await client.query(
      `SELECT tag, public_key, auth_key_hash, totp_secret_enc, totp_nonce, totp_last_step, status
       FROM wallets
       WHERE tag = $1 FOR UPDATE`,
      [tag],
    );

    if (walletRes.rows.length === 0 || walletRes.rows[0].status !== "active") {
      await client.query("ROLLBACK");
      await dummyArgonVerify(authKey);
      await recordLoginAttempt(tag, ipHash, "unlock", false);
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    const wallet = walletRes.rows[0];

    // Verify authKey
    const authValid = await verifyAuthKey(authKey, wallet.auth_key_hash);
    if (!authValid) {
      await client.query("ROLLBACK");
      await recordLoginAttempt(tag, ipHash, "unlock", false);
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    // Verify TOTP
    const secretBytes = decryptKms(wallet.totp_secret_enc, wallet.totp_nonce);
    const secretBase32 = Buffer.from(secretBytes).toString("utf8");
    const totpResult = verifyTotp(secretBase32, totpCode, Number(wallet.totp_last_step));

    if (!totpResult.valid) {
      await client.query("ROLLBACK");
      await recordLoginAttempt(tag, ipHash, "totp", false);
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    // Update TOTP last step and last_seen_at
    await client.query(
      "UPDATE wallets SET totp_last_step = $1, last_seen_at = NOW(), updated_at = NOW() WHERE tag = $2",
      [totpResult.step, tag],
    );

    // Record success
    await recordLoginAttempt(tag, ipHash, "unlock", true);

    // Create session
    const userAgent = req.headers["user-agent"];
    const { token, expiresAt } = await createSession(tag, userAgent, ipHash, client);

    await client.query("COMMIT");

    res.setHeader("Set-Cookie", serializeSessionCookie(token, expiresAt));
    res.status(200).json({
      tag,
      publicKey: wallet.public_key,
      sessionExpiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Auth unlock error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to unlock.", details: null });
  } finally {
    client.release();
  }
});

// POST /api/v1/auth/recover/challenge
// Rate limit: 5/hour/tag, 10/hour/IP
authRouter.post("/recover/challenge", ipRateLimiter("recover", 10, 3600), async (req: Request, res: Response) => {
  const { tag } = req.body || {};
  if (!tag || typeof tag !== "string") {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "tag is required.", details: null });
    return;
  }

  const normalizedTag = normalizeTag(tag);
  const ipHash = hashIp(getClientIp(req));

  try {
    const walletRes = await query("SELECT tag, public_key, status FROM wallets WHERE tag = $1", [normalizedTag]);
    if (walletRes.rows.length === 0 || walletRes.rows[0].status === "frozen") {
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    const challengeId = `rec_${nanoid(24)}`;
    const nonce = crypto.randomBytes(16).toString("base64");
    const issued = new Date().toISOString();
    const message = `Oink account recovery\nTag: @${normalizedTag}\nNonce: ${nonce}\nIssued: ${issued}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min TTL

    await query(
      `INSERT INTO auth_challenges (id, purpose, tag, is_decoy, sign_message, ip_hash, expires_at, created_at)
       VALUES ($1, 'recover', $2, FALSE, $3, $4, $5, NOW())`,
      [challengeId, normalizedTag, message, ipHash, expiresAt],
    );

    res.status(200).json({
      challengeId,
      message,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("Recover challenge error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to create recovery challenge.", details: null });
  }
});

// POST /api/v1/auth/recover/complete
authRouter.post("/recover/complete", async (req: Request, res: Response) => {
  const { challengeId, signature, publicKey, keystore, authKey, totpEnrollmentId, totpCode } = req.body || {};
  const ipHash = hashIp(getClientIp(req));

  if (!challengeId || !signature || !publicKey || !keystore || !authKey || !totpEnrollmentId || !totpCode) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "Missing required recovery fields.", details: null });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Consume challenge
    const chalRes = await client.query(
      `UPDATE auth_challenges
       SET consumed_at = NOW()
       WHERE id = $1 AND purpose = 'recover' AND consumed_at IS NULL AND expires_at > NOW()
       RETURNING tag, sign_message`,
      [challengeId],
    );

    if (chalRes.rows.length === 0) {
      await client.query("ROLLBACK");
      await recordLoginAttempt(null, ipHash, "recover", false);
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    const { tag, sign_message } = chalRes.rows[0];

    // 2. Assert publicKey equals public_key stored for that tag
    const walletRes = await client.query(
      "SELECT tag, public_key FROM wallets WHERE tag = $1 FOR UPDATE",
      [tag],
    );

    if (walletRes.rows.length === 0 || walletRes.rows[0].public_key !== publicKey) {
      await client.query("ROLLBACK");
      await recordLoginAttempt(tag, ipHash, "recover", false);
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    // 3. Verify Ed25519 signature over message
    const sigValid = verifySolanaSignature({
      wallet: publicKey,
      signature,
      message: sign_message,
    });

    if (!sigValid) {
      await client.query("ROLLBACK");
      await recordLoginAttempt(tag, ipHash, "recover", false);
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    // 4. Verify TOTP from the replacement enrollment
    const enrRes = await client.query(
      "SELECT totp_secret_enc, totp_nonce, expires_at, consumed_at FROM enrollments WHERE id = $1 FOR UPDATE",
      [totpEnrollmentId],
    );

    if (enrRes.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "NOT_FOUND", message: "Authenticator enrollment not found.", details: null });
      return;
    }

    const enr = enrRes.rows[0];
    if (enr.consumed_at || new Date(enr.expires_at).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      res.status(410).json({ error: "VALIDATION_FAILED", message: "Authenticator enrollment expired or used.", details: null });
      return;
    }

    const secretBytes = decryptKms(enr.totp_secret_enc, enr.totp_nonce);
    const secretBase32 = Buffer.from(secretBytes).toString("utf8");
    const totpResult = verifyTotp(secretBase32, totpCode);

    if (!totpResult.valid) {
      await client.query("ROLLBACK");
      await recordLoginAttempt(tag, ipHash, "recover", false);
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    // Mark enrollment consumed
    await client.query("UPDATE enrollments SET consumed_at = NOW() WHERE id = $1", [totpEnrollmentId]);

    // 5. Update wallet credentials & reset totp_last_step
    const newAuthHash = await hashAuthKey(authKey);

    await client.query(
      `UPDATE wallets
       SET ciphertext = $1,
           nonce = $2,
           kdf_salt = $3,
           kdf_params = $4,
           auth_key_hash = $5,
           totp_secret_enc = $6,
           totp_nonce = $7,
           totp_last_step = $8,
           updated_at = NOW()
       WHERE tag = $9`,
      [
        keystore.ciphertext,
        keystore.nonce,
        keystore.kdfSalt,
        JSON.stringify(keystore.kdfParams),
        newAuthHash,
        enr.totp_secret_enc,
        enr.totp_nonce,
        totpResult.step,
        tag,
      ],
    );

    // 6. Revoke every existing session for the tag
    await client.query("UPDATE sessions SET revoked_at = NOW() WHERE tag = $1", [tag]);

    // 7. Issue new session
    const userAgent = req.headers["user-agent"];
    const { token, expiresAt } = await createSession(tag, userAgent, ipHash, client);

    await recordLoginAttempt(tag, ipHash, "recover", true);
    await client.query("COMMIT");

    res.setHeader("Set-Cookie", serializeSessionCookie(token, expiresAt));
    res.status(200).json({
      tag,
      publicKey,
      sessionExpiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Recover complete error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to complete recovery.", details: null });
  } finally {
    client.release();
  }
});

// POST /api/v1/auth/logout [S]
authRouter.post("/logout", requireSession, async (req: Request, res: Response) => {
  try {
    await query("UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1", [req.sessionTokenHash]);
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.status(204).end();
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to log out.", details: null });
  }
});

// GET /api/v1/auth/session [S]
authRouter.get("/session", requireSession, async (req: Request, res: Response) => {
  try {
    const resRow = await query(
      `SELECT s.tag, w.public_key, s.expires_at, s.created_at
       FROM sessions s
       JOIN wallets w ON s.tag = w.tag
       WHERE s.token_hash = $1`,
      [req.sessionTokenHash],
    );

    if (resRow.rows.length === 0) {
      res.status(401).json({ error: "SESSION_REQUIRED", message: "Session invalid.", details: null });
      return;
    }

    const row = resRow.rows[0];
    res.status(200).json({
      tag: row.tag,
      publicKey: row.public_key,
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    });
  } catch (err) {
    console.error("Get session error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to get session.", details: null });
  }
});

// GET /api/v1/auth/sessions [S]
authRouter.get("/sessions", requireSession, async (req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT token_hash, user_agent, ip_hash, last_used_at, created_at, expires_at
       FROM sessions
       WHERE tag = $1 AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY last_used_at DESC`,
      [req.userTag],
    );

    const sessions = rows.rows.map((r) => ({
      tokenHashPrefix: r.token_hash.slice(0, 8),
      userAgent: r.user_agent,
      ipHash: r.ip_hash ? r.ip_hash.slice(0, 8) : null,
      lastUsedAt: new Date(r.last_used_at).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
      isCurrent: r.token_hash === req.sessionTokenHash,
    }));

    res.status(200).json({ sessions });
  } catch (err) {
    console.error("Get sessions error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to list sessions.", details: null });
  }
});

// DELETE /api/v1/auth/sessions/:tokenHashPrefix [S]
authRouter.delete("/sessions/:prefix", requireSession, async (req: Request, res: Response) => {
  const prefix = req.params.prefix;
  try {
    const isCurrent = req.sessionTokenHash?.startsWith(prefix);
    await query(
      "UPDATE sessions SET revoked_at = NOW() WHERE tag = $1 AND token_hash LIKE $2",
      [req.userTag, `${prefix}%`],
    );

    if (isCurrent) {
      res.setHeader("Set-Cookie", clearSessionCookie());
    }
    res.status(204).end();
  } catch (err) {
    console.error("Revoke session error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to revoke session.", details: null });
  }
});

// POST /api/v1/auth/rotate-keystore [S]
authRouter.post("/rotate-keystore", requireSession, async (req: Request, res: Response) => {
  const { oldAuthKey, totpCode, keystore, newAuthKey } = req.body || {};
  if (!oldAuthKey || !totpCode || !keystore || !newAuthKey) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "Missing required rotate fields.", details: null });
    return;
  }

  try {
    const walletRes = await query(
      "SELECT auth_key_hash, totp_secret_enc, totp_nonce, totp_last_step FROM wallets WHERE tag = $1",
      [req.userTag],
    );
    if (walletRes.rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Wallet not found.", details: null });
      return;
    }
    const wallet = walletRes.rows[0];

    const authValid = await verifyAuthKey(oldAuthKey, wallet.auth_key_hash);
    if (!authValid) {
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    const secretBytes = decryptKms(wallet.totp_secret_enc, wallet.totp_nonce);
    const secretBase32 = Buffer.from(secretBytes).toString("utf8");
    const totpResult = verifyTotp(secretBase32, totpCode, Number(wallet.totp_last_step));
    if (!totpResult.valid) {
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    const newAuthHash = await hashAuthKey(newAuthKey);
    const now = new Date();

    await query(
      `UPDATE wallets
       SET ciphertext = $1, nonce = $2, kdf_salt = $3, kdf_params = $4,
           auth_key_hash = $5, totp_last_step = $6, updated_at = $7
       WHERE tag = $8`,
      [
        keystore.ciphertext,
        keystore.nonce,
        keystore.kdfSalt,
        JSON.stringify(keystore.kdfParams),
        newAuthHash,
        totpResult.step,
        now,
        req.userTag,
      ],
    );

    // Revoke all other sessions
    await query(
      "UPDATE sessions SET revoked_at = NOW() WHERE tag = $1 AND token_hash != $2",
      [req.userTag, req.sessionTokenHash],
    );

    res.status(200).json({ rotatedAt: now.toISOString() });
  } catch (err) {
    console.error("Rotate keystore error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to rotate keystore.", details: null });
  }
});

// POST /api/v1/auth/reveal-keystore [S]
authRouter.post("/reveal-keystore", requireSession, async (req: Request, res: Response) => {
  const { authKey, totpCode } = req.body || {};
  if (!authKey || !totpCode) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "authKey and totpCode are required.", details: null });
    return;
  }

  try {
    const walletRes = await query(
      `SELECT ciphertext, nonce, kdf_salt, kdf_params, cipher, keystore_version,
              auth_key_hash, totp_secret_enc, totp_nonce, totp_last_step
       FROM wallets
       WHERE tag = $1`,
      [req.userTag],
    );

    if (walletRes.rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Wallet not found.", details: null });
      return;
    }
    const wallet = walletRes.rows[0];

    const authValid = await verifyAuthKey(authKey, wallet.auth_key_hash);
    if (!authValid) {
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    const secretBytes = decryptKms(wallet.totp_secret_enc, wallet.totp_nonce);
    const secretBase32 = Buffer.from(secretBytes).toString("utf8");
    const totpResult = verifyTotp(secretBase32, totpCode, Number(wallet.totp_last_step));
    if (!totpResult.valid) {
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid credentials.", details: null });
      return;
    }

    // Update totp_last_step
    await query("UPDATE wallets SET totp_last_step = $1 WHERE tag = $2", [totpResult.step, req.userTag]);

    res.status(200).json({
      keystore: {
        ciphertext: wallet.ciphertext,
        nonce: wallet.nonce,
        kdfSalt: wallet.kdf_salt,
        kdfParams: typeof wallet.kdf_params === "string" ? JSON.parse(wallet.kdf_params) : wallet.kdf_params,
        cipher: wallet.cipher,
        version: wallet.keystore_version,
      },
    });
  } catch (err) {
    console.error("Reveal keystore error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to reveal keystore.", details: null });
  }
});
