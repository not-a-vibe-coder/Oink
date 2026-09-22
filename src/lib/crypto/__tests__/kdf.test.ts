import { expect, test } from "bun:test";
import { splitKeys } from "../kdf";

test("HKDF splits master into 32-byte encKey and 32-byte authKey", async () => {
  const master = new Uint8Array(32).fill(42);
  const { encKey, authKey } = await splitKeys(master);

  expect(encKey).toHaveLength(32);
  expect(authKey).toHaveLength(32);
  expect(encKey).not.toEqual(authKey);

  // Deterministic output
  const second = await splitKeys(master);
  expect(second.encKey).toEqual(encKey);
  expect(second.authKey).toEqual(authKey);
});
