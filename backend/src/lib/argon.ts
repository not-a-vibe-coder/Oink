import crypto from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";
import { getConfig } from "../config";

const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$0jUjzVgcf1DXDfAHET5j9BD7Z+CSOwWhomcGkUjLc/0";

function getPepper(): string {
  return getConfig().argonPepper || "";
}

export async function hashAuthKey(authKey: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const pepper = getPepper();
  const password = pepper ? `${authKey}:${pepper}` : authKey;

  return argon2id({
    password,
    salt,
    iterations: 2,
    memorySize: 19456,
    parallelism: 1,
    hashLength: 32,
    outputType: "encoded",
  });
}

export async function verifyAuthKey(authKey: string, storedHash: string): Promise<boolean> {
  try {
    const pepper = getPepper();
    const password = pepper ? `${authKey}:${pepper}` : authKey;
    return await argon2Verify({ password, hash: storedHash });
  } catch {
    return false;
  }
}

export async function dummyArgonVerify(authKey: string): Promise<boolean> {
  try {
    const pepper = getPepper();
    const password = pepper ? `${authKey}:${pepper}` : authKey;
    return await argon2Verify({ password, hash: DUMMY_HASH });
  } catch {
    return false;
  }
}
