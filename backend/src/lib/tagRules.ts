const RESERVED_TAGS = new Set([
  "admin",
  "root",
  "support",
  "help",
  "oink",
  "oinkbot",
  "official",
  "team",
  "system",
  "api",
  "www",
  "mail",
  "security",
  "staff",
  "mod",
  "moderator",
  "wallet",
  "bank",
  "treasury",
  "fee",
  "null",
  "undefined",
  "me",
  "you",
  "test",
]);

export function normalizeTag(raw: string): string {
  if (!raw) return "";
  let tag = raw.trim().toLowerCase();
  if (tag.startsWith("@") || tag.startsWith("$")) {
    tag = tag.slice(1);
  }
  return tag;
}

export function validateTag(raw: string): { valid: boolean; reason: "taken" | "reserved" | "invalid" | null; tag: string } {
  const tag = normalizeTag(raw);

  if (!/^[a-z0-9_]{3,20}$/.test(tag)) {
    return { valid: false, reason: "invalid", tag };
  }

  if (RESERVED_TAGS.has(tag) || tag.startsWith("oink")) {
    return { valid: false, reason: "reserved", tag };
  }

  return { valid: true, reason: null, tag };
}
