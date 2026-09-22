import { Keypair } from "@solana/web3.js";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha512";

// Phantom's default account path. Every segment is hardened, which is all SLIP-0010
// allows for ed25519.
const SOLANA_PATH = [44, 501, 0, 0] as const;
const HARDENED_OFFSET = 0x80000000;

// SLIP-0010 ed25519 derivation, written against @noble/hashes rather than taken from
// ed25519-hd-key: that package pulls in create-hmac and readable-stream, which reference
// Node's `process` global and crash the browser bundle before the page can render.
// The Phantom test vector in __tests__/derive.test.ts pins the output.
function deriveEd25519(seed: Uint8Array, path: readonly number[]): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32);

  for (const segment of path) {
    const data = new Uint8Array(1 + 32 + 4);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, segment + HARDENED_OFFSET, false);
    I = hmac(sha512, chainCode, data);
    key = I.slice(0, 32);
    chainCode = I.slice(32);
  }

  return key;
}

export function keypairFromEntropy(entropy: Uint8Array): Keypair {
  const mnemonic = entropyToMnemonic(entropy, wordlist);
  const seed = mnemonicToSeedSync(mnemonic, "");
  return Keypair.fromSeed(deriveEd25519(seed, SOLANA_PATH));
}
