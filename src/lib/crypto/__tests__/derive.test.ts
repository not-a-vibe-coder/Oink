import { expect, test } from "bun:test";
import { mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { keypairFromEntropy } from "../derive";

test("derives the documented Phantom-compatible Solana address", () => {
  const entropy = mnemonicToEntropy("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", wordlist);
  expect(keypairFromEntropy(entropy).publicKey.toBase58()).toBe("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
});
