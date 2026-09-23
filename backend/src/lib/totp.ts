import crypto from "node:crypto";

const RFC4648_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  return base32Encode(bytes);
}

export function base32Encode(buffer: Buffer | Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += RFC4648_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += RFC4648_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, "").trim();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = RFC4648_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) throw new Error("Invalid base32 character: " + cleaned[i]);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateHotp(secretBuffer: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac("sha1", secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

export function verifyTotp(
  secretBase32: string,
  token: string,
  lastStep: number = 0,
  timeMs: number = Date.now(),
): { valid: boolean; step: number } {
  if (!token || token.length !== 6 || !/^\d{6}$/.test(token)) {
    return { valid: false, step: 0 };
  }
  try {
    const secretBuffer = base32Decode(secretBase32);
    const currentStep = Math.floor(timeMs / 1000 / 30);
    // Window +/- 1 step
    for (let offset = -1; offset <= 1; offset++) {
      const step = currentStep + offset;
      if (step <= lastStep) continue; // Monotonic step check prevents replay
      const expected = generateHotp(secretBuffer, step);
      if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
        return { valid: true, step };
      }
    }
  } catch {
    return { valid: false, step: 0 };
  }
  return { valid: false, step: 0 };
}

// Labelled with the account ID, not the tag: the authenticator entry is created before any
// tag exists, and the account ID is what the user types to unlock.
export function formatOtpauthUri(accountId: string, secretBase32: string): string {
  return `otpauth://totp/Oink:${encodeURIComponent(accountId)}?secret=${secretBase32}&issuer=Oink&algorithm=SHA1&digits=6&period=30`;
}
