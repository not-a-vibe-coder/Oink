import { describe, expect, test } from "bun:test";
import { ACCOUNT_ID_PATTERN, generateAccountId, isAccountId, parseIdentifier } from "../src/lib/accountId";
import { validateTag } from "../src/lib/tagRules";

describe("account IDs", () => {
  test("generated IDs match the pattern and the database CHECK", () => {
    for (let i = 0; i < 500; i++) expect(generateAccountId()).toMatch(ACCOUNT_ID_PATTERN);
  });

  test("generated IDs do not repeat", () => {
    const seen = new Set(Array.from({ length: 2000 }, generateAccountId));
    expect(seen.size).toBe(2000);
  });

  test("excludes the confusable letters", () => {
    const body = Array.from({ length: 300 }, generateAccountId).join("").replace(/oink-|-/g, "");
    expect(body).not.toMatch(/[ilou]/);
  });

  test("accepts any case and surrounding space", () => {
    expect(isAccountId("  OINK-K7P2-9XQM ")).toBe(true);
    expect(isAccountId("@oink-k7p2-9xqm")).toBe(true);
    expect(isAccountId("oink-k7p2-9xq")).toBe(false);
    expect(isAccountId("oink-k7p2-9xqu")).toBe(false);
  });

  test("an account ID can never be a valid tag", () => {
    expect(validateTag(generateAccountId()).valid).toBe(false);
  });

  test("parses either identifier form", () => {
    expect(parseIdentifier("OINK-K7P2-9XQM")).toEqual({ kind: "account", accountId: "oink-k7p2-9xqm" });
    expect(parseIdentifier("@Pascal")).toEqual({ kind: "tag", tag: "pascal" });
    expect(parseIdentifier("ab")).toBeNull();
    expect(parseIdentifier("admin")).toBeNull();
    expect(parseIdentifier(42)).toBeNull();
    expect(parseIdentifier("")).toBeNull();
  });
});
