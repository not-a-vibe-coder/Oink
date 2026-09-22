import { expect, test } from "bun:test";
import { deriveMaster, KDF_V1 } from "../argon";

test("uses the pinned Argon2id parameters", async () => {
  expect(KDF_V1).toEqual({ alg: "argon2id", v: 19, m: 65536, t: 3, p: 1, len: 32 });
  await expect(deriveMaster(new TextEncoder().encode("long enough password"), new Uint8Array(16))).resolves.toHaveLength(32);
});
