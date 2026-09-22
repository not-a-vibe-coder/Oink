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
    ciphertext: Buffer.from(encrypted).toString("base64"),
    nonce: Buffer.from(nonce).toString("base64"),
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
  const nonce = Buffer.from(blob.nonce, "base64");
  const ciphertext = Buffer.from(blob.ciphertext, "base64");

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aad as unknown as BufferSource,
    },
    cryptoKey,
    ciphertext as unknown as BufferSource,
  );

  return new Uint8Array(decrypted);
}
