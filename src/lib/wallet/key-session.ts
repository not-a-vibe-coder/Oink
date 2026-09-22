import { Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { keypairFromEntropy } from "../crypto/derive";
import { base64ToBytes, bytesToBase64 } from "../solana-bytes";

const AUTO_LOCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

let keypair: Keypair | null = null;
let lockTimer: ReturnType<typeof setTimeout> | null = null;
const lockListeners = new Set<(unlocked: boolean) => void>();

function notifyListeners(): void {
  const state = isUnlocked();
  for (const listener of lockListeners) {
    try {
      listener(state);
    } catch (err) {
      console.error("Lock change listener error:", err);
    }
  }
}

export function resetLockTimer(): void {
  if (lockTimer) clearTimeout(lockTimer);
  if (keypair) {
    lockTimer = setTimeout(() => {
      lock();
    }, AUTO_LOCK_TIMEOUT_MS);
  }
}

export function unlockWith(entropy: Uint8Array): void {
  keypair = keypairFromEntropy(entropy);
  resetLockTimer();
  notifyListeners();
}

export function isUnlocked(): boolean {
  return keypair !== null;
}

export function publicKey(): string | null {
  return keypair?.publicKey.toBase58() ?? null;
}

export function signTransaction(transactionBase64: string): string {
  if (!keypair) {
    throw new Error("Wallet is locked.");
  }
  resetLockTimer();
  const txBytes = base64ToBytes(transactionBase64);
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([keypair]);
  return bytesToBase64(tx.serialize());
}

export function signMessage(message: string): string {
  if (!keypair) {
    throw new Error("Wallet is locked.");
  }
  resetLockTimer();
  const msgBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(msgBytes, keypair.secretKey);
  return bs58.encode(signature);
}

export function lock(): void {
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }
  if (keypair) {
    // Best-effort zeroing of secret key before releasing reference
    keypair.secretKey.fill(0);
    keypair = null;
    notifyListeners();
  }
}

export function onLockChange(callback: (unlocked: boolean) => void): () => void {
  lockListeners.add(callback);
  return () => {
    lockListeners.delete(callback);
  };
}

let guardsArmed = false;

/**
 * Idle auto-lock and lock-on-leave. Called once from the app shell; the key is
 * held in module scope, so these listeners are the only thing keeping the
 * 15-minute timer honest while the user is actually using the wallet.
 */
export function armBrowserLockGuards(): void {
  if (guardsArmed || typeof window === "undefined") return;
  guardsArmed = true;

  const touch = () => {
    if (isUnlocked()) resetLockTimer();
  };

  for (const event of ["pointerdown", "keydown", "scroll", "touchstart"] as const) {
    window.addEventListener(event, touch, { passive: true });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") touch();
  });

  window.addEventListener("pagehide", () => lock());
}
