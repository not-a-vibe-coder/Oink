export type SplitKeys = { encKey: Uint8Array; authKey: Uint8Array };

export async function splitKeys(master: Uint8Array): Promise<SplitKeys> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    master as unknown as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );

  const [encKeyBits, authKeyBits] = await Promise.all([
    crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: new TextEncoder().encode("oink-enc-v1"),
      },
      baseKey,
      256,
    ),
    crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: new TextEncoder().encode("oink-auth-v1"),
      },
      baseKey,
      256,
    ),
  ]);

  return {
    encKey: new Uint8Array(encKeyBits),
    authKey: new Uint8Array(authKeyBits),
  };
}
