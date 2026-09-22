import { describe, expect, test } from "bun:test";
import { isUnlocked, lock, onLockChange, publicKey, signMessage, unlockWith } from "../key-session";

describe("key-session", () => {
  test("unlocks, signs, and locks", () => {
    const entropy = new Uint8Array(16).fill(0); // standard abandon vector
    let lockNotified = false;
    const unsub = onLockChange((state) => {
      if (!state) lockNotified = true;
    });

    expect(isUnlocked()).toBe(false);
    expect(publicKey()).toBeNull();

    unlockWith(entropy);
    expect(isUnlocked()).toBe(true);
    expect(publicKey()).toBe("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");

    const message = "Oink test message";
    const sig = signMessage(message);
    expect(typeof sig).toBe("string");
    expect(sig.length).toBeGreaterThan(40);

    lock();
    expect(isUnlocked()).toBe(false);
    expect(publicKey()).toBeNull();
    expect(lockNotified).toBe(true);

    expect(() => signMessage(message)).toThrow("Wallet is locked.");
    unsub();
  });
});
