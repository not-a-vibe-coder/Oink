/**
 * The browser half of the auth protocol, in one place.
 *
 * Enrollment, unlock, password rotation and phrase recovery all do the same four
 * things in different orders: derive `master` from the password with Argon2id,
 * split it into `encKey` / `authKey`, seal or open the keystore under an AAD
 * bound to the account ID and public key, and hand only `authKey` to the server.
 *
 * `encKey`, the entropy and the mnemonic never leave this process. Callers get
 * `authKey` base64-encoded and nothing else that could decrypt a wallet.
 */
import { deriveMaster } from "@/lib/crypto/argon";
import { KDF_V1, type KdfParams } from "@/lib/crypto/kdf-params";
import { splitKeys } from "@/lib/crypto/kdf";
import { open, seal, type KeystoreBlob } from "@/lib/crypto/keystore";
import type { KeystoreBlobPayload } from "@/types/api";

export { KDF_V1 };
export type { KdfParams, KeystoreBlob };

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomSalt(length = 16): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Best-effort scrub. Not a guarantee under a moving GC, still worth doing. */
export function zero(...buffers: Array<Uint8Array | null | undefined>): void {
  for (const buffer of buffers) buffer?.fill(0);
}

/**
 * Binds the ciphertext to the identity it belongs to, so a keystore swapped in
 * by a malicious server fails closed at decryption rather than at signing.
 * The account ID, not the tag: it exists before sealing and never changes,
 * while a tag arrives later through X (docs/12 §2).
 */
export function keystoreAad(accountId: string, publicKey: string): Uint8Array {
  return new TextEncoder().encode(`oink-keystore-v1|${accountId}|${publicKey}`);
}

/**
 * Wallets created before account IDs existed were sealed against their tag. They open
 * with this until the next password change or recovery re-seals them under the account
 * ID. Both forms bind the public key, which is what stops a swapped blob.
 */
function legacyTagAad(tag: string, publicKey: string): Uint8Array {
  return new TextEncoder().encode(`oink-keystore-v1|${tag}|${publicKey}`);
}

export interface DerivedKeys {
  encKey: Uint8Array;
  authKey: Uint8Array;
  authKeyBase64: string;
}

export async function deriveKeys(
  password: string,
  salt: Uint8Array,
  params: KdfParams = KDF_V1,
  onProgress?: (progress: number) => void,
): Promise<DerivedKeys> {
  const passwordBytes = new TextEncoder().encode(password.normalize("NFKC"));
  let master: Uint8Array | null = null;
  try {
    master = await deriveMaster(passwordBytes, salt, params, onProgress);
    const { encKey, authKey } = await splitKeys(master);
    return { encKey, authKey, authKeyBase64: toBase64(authKey) };
  } finally {
    zero(passwordBytes, master);
  }
}

/** Produces exactly the `keystore` object POST /enroll/complete expects. */
export async function sealKeystore(args: {
  encKey: Uint8Array;
  entropy: Uint8Array;
  accountId: string;
  publicKey: string;
  salt: Uint8Array;
  params?: KdfParams;
}): Promise<KeystoreBlobPayload> {
  const blob = await seal(args.encKey, args.entropy, keystoreAad(args.accountId, args.publicKey));
  return {
    ciphertext: blob.ciphertext,
    nonce: blob.nonce,
    kdfSalt: toBase64(args.salt),
    kdfParams: args.params ?? KDF_V1,
    cipher: "AES-256-GCM",
    version: 1,
  };
}

/**
 * Returns the 16 bytes of BIP-39 entropy, or null when the AES-GCM tag fails.
 * A failure here means a wrong password — the caller must not say so; see
 * docs/02 §7, every credential failure reads the same to the user.
 */
export async function openKeystore(args: {
  encKey: Uint8Array;
  blob: KeystoreBlob;
  accountId: string;
  publicKey: string;
  /** The account's tag, if any: lets a pre-account-ID keystore still open. */
  tag?: string | null;
}): Promise<Uint8Array | null> {
  try {
    return await open(args.encKey, args.blob, keystoreAad(args.accountId, args.publicKey));
  } catch {
    if (!args.tag) return null;
  }
  try {
    return await open(args.encKey, args.blob, legacyTagAad(args.tag, args.publicKey));
  } catch {
    return null;
  }
}
