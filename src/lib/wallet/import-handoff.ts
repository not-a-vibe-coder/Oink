/**
 * Carries an imported wallet's entropy from /unlock/import into /create.
 *
 * Module scope on purpose. A mnemonic must never travel through a URL, a search
 * param, a store that persists, or anything else with a shareable surface — so
 * the hand-off is a single reference held in memory, taken exactly once, and
 * zeroed the moment the wizard has used it.
 */
let pending: { entropy: Uint8Array; publicKey: string } | null = null;

export function stashImportedWallet(entropy: Uint8Array, publicKey: string): void {
  pending = { entropy, publicKey };
}

export function takeImportedWallet(): { entropy: Uint8Array; publicKey: string } | null {
  const value = pending;
  pending = null;
  return value;
}

export function hasImportedWallet(): boolean {
  return pending !== null;
}

export function clearImportedWallet(): void {
  pending?.entropy.fill(0);
  pending = null;
}
