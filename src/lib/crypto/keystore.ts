import { base64ToBytes, bytesToBase64 } from "../solana-bytes";

export type KeystoreBlob = { ciphertext: string; nonce: string; cipher: "AES-256-GCM"; version: 1 };

export async function seal(encKey: Uint8Array, entropy: Uint8Array, aad: Uint8Array): Promise<KeystoreBlob> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encKey as unknown as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aad as unknown as BufferSource,
    },
    cryptoKey,
    entropy as unknown as BufferSource,
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    nonce: bytesToBase64(nonce),
    cipher: "AES-256-GCM",
    version: 1,
  };
}

export async function open(encKey: Uint8Array, blob: KeystoreBlob, aad: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encKey as unknown as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const nonce = base64ToBytes(blob.nonce);
  const ciphertext = base64ToBytes(blob.ciphertext);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce as unknown as BufferSource,
      additionalData: aad as unknown as BufferSource,
    },
    cryptoKey,
    ciphertext as unknown as BufferSource,
  );

  return new Uint8Array(decrypted);
}
