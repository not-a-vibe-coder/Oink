import type { NextFunction, Request, Response } from "express";
import cookie from "cookie";
import { query } from "../db";
import { getConfig } from "../config";
import { generateSessionToken, hashSessionToken } from "./session";

// A separate cookie and table from wallet sessions: an admin session can read the dashboard
// and nothing else, and a wallet session can never reach the dashboard.
export const ADMIN_COOKIE_NAME = "oink_admin";
export const ADMIN_SESSION_SECONDS = 8 * 3600;

declare global {
  namespace Express {
    interface Request {
      adminEmail?: string;
    }
  }
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email) && getConfig().adminEmails.includes(email!.toLowerCase());
}

export async function createAdminSession(email: string, userAgent?: string, ipHash?: string) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000);
  await query(
    `INSERT INTO admin_sessions (token_hash, email, user_agent, ip_hash, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [hashSessionToken(token), email.toLowerCase(), userAgent || null, ipHash || null, expiresAt],
  );
  return { token, expiresAt };
}

export function serializeAdminCookie(token: string, expiresAt: Date): string {
  return cookie.serialize(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
    maxAge: ADMIN_SESSION_SECONDS,
  });
}

export function clearAdminCookie(): string {
  return cookie.serialize(ADMIN_COOKIE_NAME, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0, expires: new Date(0) });
}

export function adminTokenHash(req: Request): string | null {
  const token = req.headers.cookie ? cookie.parse(req.headers.cookie)[ADMIN_COOKIE_NAME] : undefined;
  return token ? hashSessionToken(token) : null;
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tokenHash = adminTokenHash(req);
  if (!tokenHash) {
    res.status(401).json({ error: "ADMIN_REQUIRED", message: "Sign in as an admin.", details: null });
    return;
  }
  try {
    const row = (
      await query(
        `SELECT email FROM admin_sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
        [tokenHash],
      )
    ).rows[0];
    // Re-checked on every request, so removing an address from ADMIN_EMAILS locks it out at
    // once rather than when its session expires.
    if (!row || !isAdminEmail(row.email)) {
      res.status(401).json({ error: "ADMIN_REQUIRED", message: "Sign in as an admin.", details: null });
      return;
    }
    req.adminEmail = row.email;
    next();
  } catch (err) {
    console.error("Admin session error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to verify admin session.", details: null });
  }
}
