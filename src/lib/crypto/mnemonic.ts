import { entropyToMnemonic, generateMnemonic as scureGenerate, mnemonicToEntropy, validateMnemonic as scureValidate } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

export function generateMnemonic(): string {
  return scureGenerate(wordlist, 128);
}

export function validateMnemonic(words: string): boolean {
  return scureValidate(words, wordlist);
}

export function toEntropy(words: string): Uint8Array {
  return mnemonicToEntropy(words, wordlist);
}

export function fromEntropy(bytes: Uint8Array): string {
  return entropyToMnemonic(bytes, wordlist);
}
