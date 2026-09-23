/**
 * Server-only HTTP client for the Oink API.
 *
 * Every call to api.<domain> is made from this module inside server functions,
 * so the browser never talks to the API host directly: no CORS, no API host in
 * the client bundle, and the HttpOnly session cookie stays HttpOnly.
 *
 * Two entry points:
 *   oinkFetch      — parsed JSON body only, for the common case
 *   oinkFetchRaw   — body plus the response's Set-Cookie headers, for the four
 *                    auth endpoints that mint or clear a session
 */

import { getRequestHeader } from "@tanstack/react-start/server";

const DEFAULT_PRIMARY = "http://localhost:3001";
const REQUEST_TIMEOUT_MS = 20_000;

export class OinkApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "OinkApiError";
  }
}

function env(key: string): string | undefined {
  const value = typeof process !== "undefined" && process.env ? process.env[key] : undefined;
  return value && value.trim() ? value.trim().replace(/\/+$/, "") : undefined;
}

function hosts(): string[] {
  const primary = env("OINK_API_URL") ?? env("VITE_API_URL") ?? DEFAULT_PRIMARY;
  const fallback = env("OINK_API_FALLBACK_URL");
  return fallback && primary !== fallback ? [primary, fallback] : [primary];
}

async function readError(res: Response): Promise<OinkApiError> {
  let code = "INTERNAL";
  let message = `Oink API responded ${res.status}`;
  let details: unknown = null;

  try {
    const body = (await res.json()) as { error?: string; message?: string; details?: unknown };
    if (body?.error) code = body.error;
    if (body?.message) message = body.message;
    details = body?.details;
  } catch {
    /* non-JSON response */
  }

  return new OinkApiError(code, message, res.status, details);
}

export interface OinkFetchInit {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Raw Cookie header to forward — the caller reads it off the inbound request. */
  cookie?: string;
}

export interface OinkRawResponse<T> {
  data: T;
  /** Set-Cookie values the caller must relay to the browser verbatim. */
  setCookies: string[];
}

/**
 * The browser's IP, as Vercel's edge reported it. Every API call leaves from Vercel, so
 * without this the API would rate-limit and lock out all users as one address. Vercel
 * overwrites these headers at its edge, so the browser cannot choose them. Returns
 * undefined outside a request (tests, build).
 */
function clientIp(): string | undefined {
  try {
    const real = getRequestHeader("x-real-ip");
    const forwarded = getRequestHeader("x-forwarded-for")?.split(",")[0];
    return (real || forwarded)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Node's fetch exposes multiple Set-Cookie values through getSetCookie(). */
function readSetCookies(headers: Headers): string[] {
  const typed = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof typed.getSetCookie === "function") return typed.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

export async function oinkFetchRaw<T>(
  path: string,
  init: OinkFetchInit = {},
): Promise<OinkRawResponse<T>> {
  const { method = "GET", body, query, cookie } = init;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const suffix = search.size ? `?${search}` : "";

  let lastError: unknown;

  for (const host of hosts()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        accept: "application/json",
      };
      if (body !== undefined) {
        headers["content-type"] = "application/json";
      }
      if (cookie) {
        headers["cookie"] = cookie;
      }
      // The API trusts the forwarded IP only alongside this shared secret, so a caller that
      // skips Vercel cannot claim to be someone else's address.
      const proxySecret = env("OINK_PROXY_SECRET");
      const ip = clientIp();
      if (proxySecret && ip) {
        headers["x-oink-proxy-secret"] = proxySecret;
        headers["x-oink-client-ip"] = ip;
      }

      const res = await fetch(`${host}${path}${suffix}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.ok) {
        const setCookies = readSetCookies(res.headers);
        if (res.status === 204) return { data: {} as T, setCookies };
        return { data: (await res.json()) as T, setCookies };
      }

      const error = await readError(res);
      if (res.status < 500) throw error;
      lastError = error;
    } catch (err) {
      if (err instanceof OinkApiError && err.status < 500) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError instanceof OinkApiError) throw lastError;
  throw new OinkApiError(
    "UNREACHABLE",
    lastError instanceof Error
      ? `Oink API unreachable: ${lastError.message}`
      : "Oink API unreachable",
    503,
  );
}

export async function oinkFetch<T>(path: string, init: OinkFetchInit = {}): Promise<T> {
  const { data } = await oinkFetchRaw<T>(path, init);
  return data;
}
