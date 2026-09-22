import { describe, expect, test } from "bun:test";
import { dummyArgonVerify, hashAuthKey, verifyAuthKey } from "../src/lib/argon";

describe("backend argon", () => {
  test("hashes and verifies authKey", async () => {
    const authKey = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
    const hash = await hashAuthKey(authKey);

    expect(typeof hash).toBe("string");
    expect(hash.startsWith("$argon2id$")).toBe(true);

    const valid = await verifyAuthKey(authKey, hash);
    expect(valid).toBe(true);

    const wrongKey = Buffer.from(new Uint8Array(32).fill(8)).toString("base64");
    const invalid = await verifyAuthKey(wrongKey, hash);
    expect(invalid).toBe(false);
  });

  test("dummy verify runs without throwing", async () => {
    const dummyResult = await dummyArgonVerify("dummyAuthKey");
    expect(dummyResult).toBe(false);
  });
});
