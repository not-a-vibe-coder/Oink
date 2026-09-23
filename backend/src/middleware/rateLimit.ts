import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { query } from "../db";

export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 32);
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "127.0.0.1";
}

export async function recordLoginAttempt(
  accountId: string | null,
  ipHash: string,
  kind: "unlock" | "enroll" | "totp" | "recover",
  succeeded: boolean,
): Promise<void> {
  try {
    await query(
      "INSERT INTO login_attempts (account_id, ip_hash, kind, succeeded, created_at) VALUES ($1, $2, $3, $4, NOW())",
      [accountId, ipHash, kind, succeeded],
    );
  } catch (err) {
    console.error("Failed to record login attempt:", err);
  }
}

export async function checkAccountLockout(accountId: string): Promise<{ locked: boolean; retryAfterSeconds?: number }> {
  try {
    const res = await query(
      `SELECT succeeded, created_at
       FROM login_attempts
       WHERE account_id = $1 AND kind IN ('unlock', 'totp', 'recover')
       ORDER BY created_at DESC
       LIMIT 25`,
      [accountId],
    );

    let consecutiveFailures = 0;
    let latestFailureTime: Date | null = null;

    for (const row of res.rows) {
      if (row.succeeded) break;
      consecutiveFailures++;
      if (!latestFailureTime) latestFailureTime = new Date(row.created_at);
    }

    if (!latestFailureTime || consecutiveFailures < 5) {
      return { locked: false };
    }

    const elapsedSeconds = (Date.now() - latestFailureTime.getTime()) / 1000;

    let requiredWaitSeconds = 0;
    if (consecutiveFailures >= 20) {
      requiredWaitSeconds = 24 * 3600; // 24 hours
    } else if (consecutiveFailures >= 10) {
      requiredWaitSeconds = 15 * 60; // 15 minutes
    } else if (consecutiveFailures >= 5) {
      requiredWaitSeconds = 60; // 1 minute
    }

    if (elapsedSeconds < requiredWaitSeconds) {
      return {
        locked: true,
        retryAfterSeconds: Math.ceil(requiredWaitSeconds - elapsedSeconds),
      };
    }
  } catch (err) {
    console.error("Check account lockout error:", err);
  }

  return { locked: false };
}

export async function checkIpLimit(
  ipHash: string,
  kind: string,
  maxCount: number,
  windowSeconds: number,
): Promise<{ limited: boolean; retryAfterSeconds?: number }> {
  try {
    const res = await query(
      `SELECT COUNT(*) as count, MIN(created_at) as oldest
       FROM login_attempts
       WHERE ip_hash = $1 AND kind = $2 AND created_at > NOW() - ($3 || ' seconds')::INTERVAL`,
      [ipHash, kind, windowSeconds],
    );

    const count = parseInt(res.rows[0]?.count || "0", 10);
    if (count >= maxCount) {
      const oldest = res.rows[0]?.oldest ? new Date(res.rows[0].oldest).getTime() : Date.now();
      const elapsed = (Date.now() - oldest) / 1000;
      const retryAfter = Math.max(1, Math.ceil(windowSeconds - elapsed));
      return { limited: true, retryAfterSeconds: retryAfter };
    }
  } catch (err) {
    console.error("Check IP limit error:", err);
  }

  return { limited: false };
}

export function ipRateLimiter(kind: string, maxCount: number, windowSeconds: number = 3600) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ipHash = hashIp(getClientIp(req));
    const limit = await checkIpLimit(ipHash, kind, maxCount, windowSeconds);
    if (limit.limited) {
      res.setHeader("Retry-After", limit.retryAfterSeconds?.toString() || "60");
      res.status(429).json({
        error: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
        details: null,
      });
      return;
    }
    next();
  };
}
