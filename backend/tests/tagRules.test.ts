import { describe, expect, test } from "bun:test";
import { normalizeTag, validateTag } from "../src/lib/tagRules";

describe("backend tagRules", () => {
  test("normalizes tags", () => {
    expect(normalizeTag("@Pascal")).toBe("pascal");
    expect(normalizeTag("$pascal")).toBe("pascal");
    expect(normalizeTag("  PASCAL  ")).toBe("pascal");
  });

  test("validates tag length and characters", () => {
    expect(validateTag("ab").valid).toBe(false);
    expect(validateTag("a".repeat(21)).valid).toBe(false);
    expect(validateTag("pas-cal").valid).toBe(false);
    expect(validateTag("pascal").valid).toBe(true);
    expect(validateTag("pas_cal_99").valid).toBe(true);
  });

  test("rejects reserved tags and oink prefixes", () => {
    expect(validateTag("admin").valid).toBe(false);
    expect(validateTag("admin").reason).toBe("reserved");
    expect(validateTag("oinkbot").valid).toBe(false);
    expect(validateTag("oink_wallet").valid).toBe(false);
    expect(validateTag("wallet").valid).toBe(false);
  });
});
