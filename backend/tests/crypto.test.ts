import { describe, expect, test } from "bun:test";
import { decryptKms, encryptKms, generateDecoyChallenge } from "../src/lib/crypto";

describe("backend crypto", () => {
  test("encryptKms and decryptKms round-trip", () => {
    const data = new TextEncoder().encode("secret-totp-base32-key");
    const { ciphertext, nonce } = encryptKms(data);

    expect(typeof ciphertext).toBe("string");
    expect(typeof nonce).toBe("string");

    const decrypted = decryptKms(ciphertext, nonce);
    expect(decrypted).toEqual(data);
  });

  test("generateDecoyChallenge is deterministic for the same tag", () => {
    const decoy1 = generateDecoyChallenge("pascal");
    const decoy2 = generateDecoyChallenge("pascal");

    expect(decoy1.kdfSalt).toBe(decoy2.kdfSalt);
    expect(decoy1.keystore.ciphertext).toBe(decoy2.keystore.ciphertext);
    expect(decoy1.keystore.nonce).toBe(decoy2.keystore.nonce);
    expect(decoy1.kdfParams.m).toBe(65536);
  });

  test("generateDecoyChallenge differs across different tags", () => {
    const decoyA = generateDecoyChallenge("alice");
    const decoyB = generateDecoyChallenge("bob");

    expect(decoyA.kdfSalt).not.toBe(decoyB.kdfSalt);
    expect(decoyA.keystore.ciphertext).not.toBe(decoyB.keystore.ciphertext);
  });
});
