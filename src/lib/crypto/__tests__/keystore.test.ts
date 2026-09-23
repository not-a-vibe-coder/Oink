import { expect, test } from "bun:test";
import { open, seal } from "../keystore";

const encKey = new Uint8Array(32).fill(1);
const entropy = new Uint8Array(16).fill(2);
const aad = new TextEncoder().encode("oink-keystore-v1|oink-k7p2-9xqm|public-key");

test("round-trips encrypted entropy", async () => {
  expect(await open(encKey, await seal(encKey, entropy, aad), aad)).toEqual(entropy);
});

test("rejects a different encryption key", async () => {
  const blob = await seal(encKey, entropy, aad);
  await expect(open(new Uint8Array(32).fill(3), blob, aad)).rejects.toThrow();
});

test("rejects an AAD swap", async () => {
  const blob = await seal(encKey, entropy, aad);
  await expect(open(encKey, blob, new TextEncoder().encode("oink-keystore-v1|oink-k7p2-9xqn|public-key"))).rejects.toThrow();
});
