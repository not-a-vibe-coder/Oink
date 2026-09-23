import crypto from "node:crypto";
import { normalizeTag, validateTag } from "./tagRules";

// Crockford base32 without i, l, o, u: nothing a user can misread when typing it back in
// on another device, which is the only reason this ID exists (docs/12 §2).
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const ACCOUNT_ID_PATTERN = /^oink-[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}$/;

export function generateAccountId(): string {
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] & 31];
  return `oink-${out.slice(0, 4)}-${out.slice(4)}`;
}

export function normalizeAccountId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isAccountId(raw: string): boolean {
  return ACCOUNT_ID_PATTERN.test(normalizeAccountId(raw));
}

export type Identifier = { kind: "account"; accountId: string } | { kind: "tag"; tag: string };

// Unlock and recovery accept either form in one box. They cannot collide: tags forbid '-'
// and reserve everything starting with "oink".
export function parseIdentifier(raw: unknown): Identifier | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  if (isAccountId(raw)) return { kind: "account", accountId: normalizeAccountId(raw) };
  const tag = normalizeTag(raw);
  return validateTag(tag).valid ? { kind: "tag", tag } : null;
}

// SQL fragment and parameter for looking a wallet up by either form.
export function identifierLookup(id: Identifier): { where: string; value: string } {
  return id.kind === "account" ? { where: "account_id = $1", value: id.accountId } : { where: "tag = $1", value: id.tag };
}
