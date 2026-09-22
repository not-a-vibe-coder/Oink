import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import cookie from "cookie";
import { query } from "../db";

export const SESSION_COOKIE_NAME = "oink_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 3600; // 7 days
export const SESSION_IDLE_TIMEOUT_SECONDS = 24 * 3600; // 24 hours

export interface SessionData {
  tag: string;
  tokenHash: string;
  expiresAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      userTag?: string;
      sessionTokenHash?: string;
    }
  }
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function serializeSessionCookie(token: string, expiresAt: Date): string {
  const isProduction = process.env.NODE_ENV === "production";
  return cookie.serialize(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(): string {
  return cookie.serialize(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}

export async function createSession(tag: string, userAgent?: string, ipHash?: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await query(
    `INSERT INTO sessions (token_hash, tag, user_agent, ip_hash, created_at, last_used_at, expires_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)`,
    [tokenHash, tag.toLowerCase(), userAgent || null, ipHash || null, expiresAt],
  );

  return { token, expiresAt };
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    res.status(401).json({ error: "SESSION_REQUIRED", message: "Session required.", details: null });
    return;
  }

  const parsedCookies = cookie.parse(cookieHeader);
  const token = parsedCookies[SESSION_COOKIE_NAME];

  if (!token) {
    res.status(401).json({ error: "SESSION_REQUIRED", message: "Session required.", details: null });
    return;
  }

  const tokenHash = hashSessionToken(token);

  try {
    const result = await query(
      `SELECT tag, last_used_at, expires_at, revoked_at
       FROM sessions
       WHERE token_hash = $1`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: "SESSION_REQUIRED", message: "Session invalid or expired.", details: null });
      return;
    }

    const session = result.rows[0];

    if (session.revoked_at) {
      res.status(401).json({ error: "SESSION_REQUIRED", message: "Session has been revoked.", details: null });
      return;
    }

    const now = Date.now();
    const expiresAt = new Date(session.expires_at).getTime();
    const lastUsedAt = new Date(session.last_used_at).getTime();

    if (now > expiresAt || now - lastUsedAt > SESSION_IDLE_TIMEOUT_SECONDS * 1000) {
      res.status(401).json({ error: "SESSION_REQUIRED", message: "Session expired.", details: null });
      return;
    }

    // Refresh last_used_at
    await query("UPDATE sessions SET last_used_at = NOW() WHERE token_hash = $1", [tokenHash]);

    req.userTag = session.tag;
    req.sessionTokenHash = tokenHash;
    next();
  } catch (err) {
    console.error("Session verification error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to verify session.", details: null });
  }
}
