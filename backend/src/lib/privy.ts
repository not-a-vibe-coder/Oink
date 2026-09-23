import { importSPKI, jwtVerify } from "jose";
import { getConfig } from "../config";

/**
 * Privy is used only to prove identities: "this person controls izuu@gmail.com" or "this
 * person controls X account 12345". The browser completes Privy's email code or X OAuth,
 * gets an identity token, and hands it here. We verify it offline against the app's
 * ES256 verification key and read the linked accounts out of it. Nothing about a
 * wallet's keys ever touches Privy.
 */

export class PrivyNotConfiguredError extends Error {
  constructor() {
    super("Privy is not configured.");
  }
}

export class InvalidIdentityTokenError extends Error {}

export interface VerifiedIdentity {
  privyUserId: string;
  email: string | null;
  x: { userId: string; username: string } | null;
}

let cachedKey: { pem: string; key: CryptoKey } | null = null;

async function verificationKey(pem: string): Promise<CryptoKey> {
  if (cachedKey?.pem !== pem) cachedKey = { pem, key: (await importSPKI(pem, "ES256")) as CryptoKey };
  return cachedKey.key;
}

export function privyConfigured(): boolean {
  const config = getConfig();
  return Boolean(config.privyAppId && config.privyVerificationKey);
}

type LinkedAccount = Record<string, unknown> & { type?: unknown };

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

// Privy puts linked_accounts in the token as a JSON string. Field names are read
// defensively: the email is `address`, the X account is `subject` + `username`.
export function parseLinkedAccounts(raw: unknown): Pick<VerifiedIdentity, "email" | "x"> {
  let accounts: LinkedAccount[] = [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) accounts = parsed.filter((a): a is LinkedAccount => Boolean(a) && typeof a === "object");
  } catch {
    throw new InvalidIdentityTokenError("linked_accounts is not valid JSON");
  }

  let email: string | null = null;
  let x: VerifiedIdentity["x"] = null;
  for (const account of accounts) {
    if (account.type === "email" && !email) {
      const address = str(account.address) ?? str(account.email);
      if (address && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) email = address.toLowerCase();
    }
    if (account.type === "twitter_oauth" && !x) {
      const userId = str(account.subject);
      const username = str(account.username)?.replace(/^@/, "");
      if (userId && username) x = { userId, username };
    }
  }
  return { email, x };
}

export async function verifyIdentityToken(token: unknown): Promise<VerifiedIdentity> {
  const config = getConfig();
  if (!config.privyAppId || !config.privyVerificationKey) throw new PrivyNotConfiguredError();
  if (typeof token !== "string" || token.length > 8192) throw new InvalidIdentityTokenError("missing token");

  let payload;
  try {
    ({ payload } = await jwtVerify(token, await verificationKey(config.privyVerificationKey), {
      issuer: "privy.io",
      audience: config.privyAppId,
      algorithms: ["ES256"],
      maxTokenAge: "1h",
    }));
  } catch (err) {
    throw new InvalidIdentityTokenError(err instanceof Error ? err.message : "verification failed");
  }

  if (typeof payload.sub !== "string") throw new InvalidIdentityTokenError("missing sub");
  return { privyUserId: payload.sub, ...parseLinkedAccounts(payload.linked_accounts) };
}
