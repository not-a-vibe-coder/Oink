import { expect, test } from "bun:test";
import { seal } from "@/lib/crypto/keystore";
import { openKeystore, sealKeystore } from "../credentials";

const encKey = new Uint8Array(32).fill(1);
const entropy = new Uint8Array(16).fill(2);
const accountId = "oink-k7p2-9xqm";
const publicKey = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const encode = (value: string) => new TextEncoder().encode(value);

test("a keystore sealed under the account ID opens", async () => {
  const blob = await sealKeystore({ encKey, entropy, accountId, publicKey, salt: new Uint8Array(16) });
  expect(await openKeystore({ encKey, blob, accountId, publicKey })).toEqual(entropy);
});

test("a pre-account-ID keystore opens through its tag", async () => {
  const blob = await seal(encKey, entropy, encode(`oink-keystore-v1|pascal|${publicKey}`));
  expect(await openKeystore({ encKey, blob, accountId, publicKey, tag: "pascal" })).toEqual(entropy);
});

test("the tag fallback still binds the public key", async () => {
  const blob = await seal(encKey, entropy, encode(`oink-keystore-v1|pascal|${publicKey}`));
  expect(await openKeystore({ encKey, blob, accountId, publicKey: "SomeOtherKey1111", tag: "pascal" })).toBeNull();
});

test("no fallback without a tag, and a wrong tag fails closed", async () => {
  const blob = await seal(encKey, entropy, encode(`oink-keystore-v1|pascal|${publicKey}`));
  expect(await openKeystore({ encKey, blob, accountId, publicKey })).toBeNull();
  expect(await openKeystore({ encKey, blob, accountId, publicKey, tag: "izuu" })).toBeNull();
});

test("a wrong password fails both bindings", async () => {
  const blob = await seal(encKey, entropy, encode(`oink-keystore-v1|pascal|${publicKey}`));
  const wrong = new Uint8Array(32).fill(9);
  expect(await openKeystore({ encKey: wrong, blob, accountId, publicKey, tag: "pascal" })).toBeNull();
});
