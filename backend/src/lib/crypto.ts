import crypto from "node:crypto";
import { getConfig } from "../config";

function getKmsKey(): Buffer {
  const raw = getConfig().kmsKey;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("OINK_KMS_KEY is required in production.");
    }
    // Default 32-byte key for local development/test
    return Buffer.alloc(32, 1);
  }
  return Buffer.from(raw, "base64");
}

function getDecoyKey(): Buffer {
  const raw = getConfig().decoyKey;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("OINK_DECOY_KEY is required in production.");
    }
    // Default 32-byte key for local development/test
    return Buffer.alloc(32, 2);
  }
  return Buffer.from(raw, "base64");
}

export function encryptKms(plaintext: Uint8Array): { ciphertext: string; nonce: string } {
  const key = getKmsKey();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return {
    ciphertext: encrypted.toString("base64"),
    nonce: nonce.toString("base64"),
  };
}

export function decryptKms(ciphertext: string, nonce: string): Uint8Array {
  const key = getKmsKey();
  const nonceBuf = Buffer.from(nonce, "base64");
  const raw = Buffer.from(ciphertext, "base64");
  if (raw.length < 16) throw new Error("Invalid ciphertext length");
  const tag = raw.subarray(raw.length - 16);
  const data = raw.subarray(0, raw.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonceBuf);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(data), decipher.final()]));
}

const ACCOUNT_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

// Keyed on whatever the caller typed (tag or account ID), so repeated probes for the same
// unknown identifier see the same salt, keystore and account ID a real wallet would return.
export function generateDecoyChallenge(identifier: string) {
  const key = getDecoyKey();
  const hmac = crypto.createHmac("sha256", key).update(identifier.toLowerCase()).digest();
  const idBytes = crypto.createHmac("sha256", hmac).update("account").digest();
  let idBody = "";
  for (let i = 0; i < 8; i++) idBody += ACCOUNT_ID_ALPHABET[idBytes[i] & 31];
  const accountId = `oink-${idBody.slice(0, 4)}-${idBody.slice(4)}`;

  // Deterministic 16-byte salt and 12-byte nonce derived from HMAC
  const kdfSalt = crypto.createHmac("sha256", hmac).update("salt").digest().subarray(0, 16).toString("base64");
  const nonce = crypto.createHmac("sha256", hmac).update("nonce").digest().subarray(0, 12).toString("base64");
  // Deterministic 32-byte ciphertext (16 bytes payload + 16 bytes tag)
  const ciphertext = crypto.createHmac("sha256", hmac).update("ciphertext").digest().toString("base64");

  return {
    accountId,
    kdfSalt,
    kdfParams: { alg: "argon2id" as const, v: 19 as const, m: 65536 as const, t: 3 as const, p: 1 as const, len: 32 as const },
    keystore: {
      ciphertext,
      nonce,
      cipher: "AES-256-GCM" as const,
      version: 1 as const,
    },
    requiresTotp: true,
  };
}
