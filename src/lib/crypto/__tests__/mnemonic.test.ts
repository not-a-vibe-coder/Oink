import { describe, expect, test } from "bun:test";
import { fromEntropy, generateMnemonic, toEntropy, validateMnemonic } from "../mnemonic";

describe("mnemonic", () => {
  test("generates and validates a 12-word BIP39 mnemonic", () => {
    const words = generateMnemonic();
    expect(words.trim().split(/\s+/)).toHaveLength(12);
    expect(validateMnemonic(words)).toBeTrue();
  });

  test("round-trips exactly 128-bit entropy", () => {
    const entropy = new Uint8Array(16).fill(7);
    expect(toEntropy(fromEntropy(entropy))).toEqual(entropy);
  });
});
