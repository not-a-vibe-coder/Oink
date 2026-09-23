import { Router, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import { pool, query } from "../db";
import { encryptKms, decryptKms } from "../lib/crypto";
import { generateTotpSecret, verifyTotp, formatOtpauthUri } from "../lib/totp";
import { hashAuthKey } from "../lib/argon";
import { validateTag } from "../lib/tagRules";
import { hashIp, getClientIp, ipRateLimiter } from "../middleware/rateLimit";
import { createSession, serializeSessionCookie } from "../middleware/session";

export const enrollRouter = Router();

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// POST /api/v1/enroll/start
// Rate limit: 10/hour/IP
enrollRouter.post("/start", ipRateLimiter("enroll", 10, 3600), async (req: Request, res: Response) => {
  try {
    const enrollmentId = `enr_${nanoid(24)}`;
    const secretBase32 = generateTotpSecret();
    const tagHint = typeof req.body?.tagHint === "string" ? req.body.tagHint : "pending";
    const otpauthUri = formatOtpauthUri(tagHint, secretBase32);

    const secretBytes = Buffer.from(secretBase32, "utf8");
    const { ciphertext, nonce } = encryptKms(secretBytes);

    const ipHash = hashIp(getClientIp(req));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes TTL

    await query(
      `INSERT INTO enrollments (id, totp_secret_enc, totp_nonce, ip_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [enrollmentId, ciphertext, nonce, ipHash, expiresAt],
    );

    res.status(201).json({
      enrollmentId,
      totpSecret: secretBase32,
      otpauthUri,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("Enroll start error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to start enrollment.", details: null });
  }
});

// POST /api/v1/enroll/verify-totp
enrollRouter.post("/verify-totp", async (req: Request, res: Response) => {
  const { enrollmentId, totpCode } = req.body || {};
  if (!enrollmentId || !totpCode) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "enrollmentId and totpCode are required.", details: null });
    return;
  }

  try {
    const result = await query(
      "SELECT totp_secret_enc, totp_nonce, expires_at, consumed_at FROM enrollments WHERE id = $1",
      [enrollmentId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Enrollment not found.", details: null });
      return;
    }

    const row = result.rows[0];
    if (row.consumed_at || new Date(row.expires_at).getTime() < Date.now()) {
      res.status(410).json({ error: "VALIDATION_FAILED", message: "Enrollment expired or already used.", details: null });
      return;
    }

    const secretBytes = decryptKms(row.totp_secret_enc, row.totp_nonce);
    const secretBase32 = Buffer.from(secretBytes).toString("utf8");

    const check = verifyTotp(secretBase32, totpCode);
    if (!check.valid) {
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid authenticator code.", details: null });
      return;
    }

    res.status(200).json({ valid: true });
  } catch (err) {
    console.error("Enroll verify TOTP error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to verify authenticator code.", details: null });
  }
});

// POST /api/v1/enroll/complete
enrollRouter.post("/complete", async (req: Request, res: Response) => {
  const { enrollmentId, tag, publicKey, keystore, authKey, totpCode } = req.body || {};

  if (!enrollmentId || !tag || !publicKey || !keystore || !authKey || !totpCode) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "Missing required enrollment fields.", details: null });
    return;
  }

  const { valid: tagValid, reason: tagReason, tag: normalizedTag } = validateTag(tag);
  if (!tagValid) {
    res.status(400).json({
      error: "VALIDATION_FAILED",
      message: tagReason === "reserved" ? "That tag is reserved." : "Invalid tag format.",
      details: null,
    });
    return;
  }

  if (
    !keystore.ciphertext ||
    !keystore.nonce ||
    !keystore.kdfSalt ||
    !keystore.kdfParams ||
    keystore.cipher !== "AES-256-GCM" ||
    keystore.version !== 1
  ) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "Malformed keystore blob.", details: null });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Fetch & lock enrollment row
    const enrResult = await client.query(
      "SELECT totp_secret_enc, totp_nonce, expires_at, consumed_at FROM enrollments WHERE id = $1 FOR UPDATE",
      [enrollmentId],
    );

    if (enrResult.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "NOT_FOUND", message: "Enrollment not found.", details: null });
      return;
    }

    const enr = enrResult.rows[0];
    if (enr.consumed_at || new Date(enr.expires_at).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      res.status(410).json({ error: "VALIDATION_FAILED", message: "Enrollment expired or already used.", details: null });
      return;
    }

    // 2. Decrypt & verify TOTP code
    const secretBytes = decryptKms(enr.totp_secret_enc, enr.totp_nonce);
    const secretBase32 = Buffer.from(secretBytes).toString("utf8");
    const totpResult = verifyTotp(secretBase32, totpCode);

    if (!totpResult.valid) {
      await client.query("ROLLBACK");
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid authenticator code.", details: null });
      return;
    }

    // 3. Check tag and public key uniqueness
    const existingWallet = await client.query(
      "SELECT tag, public_key FROM wallets WHERE tag = $1 OR public_key = $2",
      [normalizedTag, publicKey],
    );
    if (existingWallet.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "TAG_TAKEN", message: "That tag or wallet address is already registered.", details: null });
      return;
    }

    // 4. Hash authKey
    const authKeyHash = await hashAuthKey(authKey);

    // 5. Insert wallet
    const createdAt = new Date();
    await client.query(
      `INSERT INTO wallets (
        tag, public_key, keystore_version, cipher, ciphertext, nonce, kdf_salt, kdf_params,
        auth_key_hash, totp_secret_enc, totp_nonce, totp_last_step, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13, $13)`,
      [
        normalizedTag,
        publicKey,
        keystore.version,
        keystore.cipher,
        keystore.ciphertext,
        keystore.nonce,
        keystore.kdfSalt,
        JSON.stringify(keystore.kdfParams),
        authKeyHash,
        enr.totp_secret_enc,
        enr.totp_nonce,
        totpResult.step,
        createdAt,
      ],
    );

    // 6. Insert default 100% USDC election if elections table exists
    try {
      await client.query(
        `INSERT INTO elections (tag, asset_symbol, asset_mint, decimals, basis_points, is_active, created_at, updated_at)
         VALUES ($1, 'USDC', $2, 6, 10000, true, $3, $3)`,
        [normalizedTag, USDC_MINT, createdAt],
      );
    } catch {
      // If elections table is created in later migration, handle gracefully
    }

    // 7. Mark enrollment consumed
    await client.query("UPDATE enrollments SET consumed_at = NOW() WHERE id = $1", [enrollmentId]);

    // 8. Create session
    const ipHash = hashIp(getClientIp(req));
    const userAgent = req.headers["user-agent"];
    const { token, expiresAt } = await createSession(normalizedTag, userAgent, ipHash, client);

    await client.query("COMMIT");

    res.setHeader("Set-Cookie", serializeSessionCookie(token, expiresAt));
    res.status(201).json({
      tag: normalizedTag,
      publicKey,
      elections: [{ symbol: "USDC", mint: USDC_MINT, basisPoints: 10000, percentage: 100 }],
      sessionExpiresAt: expiresAt.toISOString(),
      createdAt: createdAt.toISOString(),
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err?.code === "23505") {
      res.status(409).json({ error: "TAG_TAKEN", message: "That tag is already claimed.", details: null });
      return;
    }
    console.error("Enroll complete error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to complete enrollment.", details: null });
  } finally {
    client.release();
  }
});
