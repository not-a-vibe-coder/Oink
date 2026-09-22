import { Keypair } from "@solana/web3.js";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { derivePath } from "ed25519-hd-key";

export function keypairFromEntropy(entropy: Uint8Array): Keypair {
  const mnemonic = entropyToMnemonic(entropy, wordlist);
  const seed = mnemonicToSeedSync(mnemonic, "");
  const derived = derivePath("m/44'/501'/0'/0'", Buffer.from(seed).toString("hex"));
  return Keypair.fromSeed(derived.key);
}
