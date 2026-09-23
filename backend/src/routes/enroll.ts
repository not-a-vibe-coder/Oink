import { Router, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import { pool, query } from "../db";
import { encryptKms, decryptKms } from "../lib/crypto";
import { generateTotpSecret, verifyTotp, formatOtpauthUri } from "../lib/totp";
import { hashAuthKey } from "../lib/argon";
import { generateAccountId } from "../lib/accountId";
import { recordEvent } from "../lib/events";
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

    const secretBytes = Buffer.from(secretBase32, "utf8");
    const { ciphertext, nonce } = encryptKms(secretBytes);

    const ipHash = hashIp(getClientIp(req));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes TTL

    // The account ID is fixed here, before the browser seals the keystore, because the AAD
    // binds it. 40 random bits make a clash vanishingly rare; the unique constraints turn one
    // into a retry rather than a shared ID.
    let accountId = "";
    for (let attempt = 0; attempt < 5 && !accountId; attempt++) {
      const candidate = generateAccountId();
      const inserted = await query(
        `INSERT INTO enrollments (id, account_id, totp_secret_enc, totp_nonce, ip_hash, expires_at, created_at)
         SELECT $1, $2::varchar, $3, $4, $5, $6, NOW()
         WHERE NOT EXISTS (SELECT 1 FROM wallets WHERE account_id = $2::varchar)
         ON CONFLICT (account_id) DO NOTHING
         RETURNING account_id`,
        [enrollmentId, candidate, ciphertext, nonce, ipHash, expiresAt],
      );
      if (inserted.rows.length > 0) accountId = candidate;
    }
    if (!accountId) throw new Error("Could not allocate an account ID");

    res.status(201).json({
      enrollmentId,
      accountId,
      totpSecret: secretBase32,
      otpauthUri: formatOtpauthUri(accountId, secretBase32),
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
  // No tag here: a tag is claimed later by linking X (docs/12 §3).
  const { enrollmentId, publicKey, keystore, authKey, totpCode } = req.body || {};

  if (!enrollmentId || !publicKey || !keystore || !authKey || !totpCode) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "Missing required enrollment fields.", details: null });
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
      "SELECT account_id, totp_secret_enc, totp_nonce, expires_at, consumed_at FROM enrollments WHERE id = $1 FOR UPDATE",
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

    const accountId: string = enr.account_id;

    // 3. One Oink account per keypair. An imported phrase that is already registered belongs
    // on the recovery path, not a second account.
    const existingWallet = await client.query("SELECT 1 FROM wallets WHERE public_key = $1", [publicKey]);
    if (existingWallet.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "WALLET_EXISTS", message: "That wallet is already registered. Recover it instead.", details: null });
      return;
    }

    // 4. Hash authKey
    const authKeyHash = await hashAuthKey(authKey);

    // 5. Insert wallet
    const createdAt = new Date();
    await client.query(
      `INSERT INTO wallets (
        account_id, public_key, keystore_version, cipher, ciphertext, nonce, kdf_salt, kdf_params,
        auth_key_hash, totp_secret_enc, totp_nonce, totp_last_step, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13, $13)`,
      [
        accountId,
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

    // 6. Default mix: 100% USDC
    await client.query(
      `INSERT INTO mixes (account_id, asset_symbol, asset_mint, decimals, basis_points, is_active, created_at, updated_at)
       VALUES ($1, 'USDC', $2, 6, 10000, true, $3, $3)`,
      [accountId, USDC_MINT, createdAt],
    );

    // 7. Mark enrollment consumed
    await client.query("UPDATE enrollments SET consumed_at = NOW() WHERE id = $1", [enrollmentId]);

    // 8. Create session
    const ipHash = hashIp(getClientIp(req));
    const userAgent = req.headers["user-agent"];
    const { token, expiresAt } = await createSession(accountId, userAgent, ipHash, client);
    await recordEvent(accountId, "wallet_created", {}, ipHash, client);

    await client.query("COMMIT");

    res.setHeader("Set-Cookie", serializeSessionCookie(token, expiresAt));
    res.status(201).json({
      accountId,
      tag: null,
      publicKey,
      mix: [{ symbol: "USDC", mint: USDC_MINT, basisPoints: 10000, percentage: 100 }],
      sessionExpiresAt: expiresAt.toISOString(),
      createdAt: createdAt.toISOString(),
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err?.code === "23505") {
      res.status(409).json({ error: "WALLET_EXISTS", message: "That wallet is already registered. Recover it instead.", details: null });
      return;
    }
    console.error("Enroll complete error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to complete enrollment.", details: null });
  } finally {
    client.release();
  }
});
