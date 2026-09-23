import { PublicKey } from "@solana/web3.js";
import { parseIdentifier, type Identifier } from "./accountId";

/**
 * Everything the send box accepts: a Solana address, an Oink tag or account ID, an email, or
 * an X account written as `x:@name`, `x.com/name` or `twitter.com/name`. The X forms need a
 * prefix because a bare `@name` is an Oink tag.
 */
export type ParsedRecipient =
  | { kind: "address"; address: string }
  | { kind: "identifier"; id: Identifier }
  | { kind: "email"; email: string }
  | { kind: "x"; username: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const X_FORMS = [/^x:\s*@?([A-Za-z0-9_]{1,15})$/i, /^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})\/?$/i];

export function parseRecipient(raw: unknown): ParsedRecipient | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;

  try {
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
      new PublicKey(value);
      return { kind: "address", address: value };
    }
  } catch {
    /* not an address */
  }

  if (EMAIL.test(value) && value.length <= 254) return { kind: "email", email: value.toLowerCase() };

  for (const form of X_FORMS) {
    const match = value.match(form);
    if (match) return { kind: "x", username: match[1] };
  }

  const id = parseIdentifier(value);
  return id ? { kind: "identifier", id } : null;
}
