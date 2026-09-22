import { describe, expect, test } from "bun:test";
import {
  base32Decode,
  base32Encode,
  generateHotp,
  generateTotpSecret,
  verifyTotp,
} from "../src/lib/totp";

describe("backend totp", () => {
  test("generates 32-character base32 secret", () => {
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(32);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  test("base32 round-trips arbitrary bytes", () => {
    const bytes = Buffer.from([1, 2, 3, 4, 5, 250, 255]);
    const encoded = base32Encode(bytes);
    expect(base32Decode(encoded)).toEqual(bytes);
  });

  test("verifies valid TOTP code in current, -1, and +1 steps", () => {
    const secret = "JBSWY3DPEHPK3PXP"; // 10 bytes base32
    const secretBuffer = base32Decode(secret);
    const now = Date.now();
    const currentStep = Math.floor(now / 1000 / 30);

    const currentCode = generateHotp(secretBuffer, currentStep);
    const prevCode = generateHotp(secretBuffer, currentStep - 1);
    const nextCode = generateHotp(secretBuffer, currentStep + 1);

    expect(verifyTotp(secret, currentCode, 0, now).valid).toBe(true);
    expect(verifyTotp(secret, prevCode, 0, now).valid).toBe(true);
    expect(verifyTotp(secret, nextCode, 0, now).valid).toBe(true);

    // Outside window (-2, +2 steps)
    const oldCode = generateHotp(secretBuffer, currentStep - 2);
    expect(verifyTotp(secret, oldCode, 0, now).valid).toBe(false);

    // Replay rejection: monotonic step check
    const verified = verifyTotp(secret, currentCode, 0, now);
    expect(verified.valid).toBe(true);
    // Supplying code at or below verified.step must fail!
    expect(verifyTotp(secret, currentCode, verified.step, now).valid).toBe(false);
    expect(verifyTotp(secret, prevCode, verified.step, now).valid).toBe(false);
  });
});
