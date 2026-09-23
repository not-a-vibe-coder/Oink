import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPair } from "jose";
import {
  InvalidIdentityTokenError,
  PrivyNotConfiguredError,
  parseLinkedAccounts,
  verifyIdentityToken,
} from "../src/lib/privy";
import { installFakePrivy } from "./helpers/privyTokens";

describe("parseLinkedAccounts", () => {
  test("reads the email and the X account", () => {
    const raw = JSON.stringify([
      { type: "email", address: "Izuu@Gmail.com" },
      { type: "twitter_oauth", subject: "1234", username: "@Izuu_X", name: "Izuu" },
      { type: "wallet", address: "abc" },
    ]);
    expect(parseLinkedAccounts(raw)).toEqual({ email: "izuu@gmail.com", x: { userId: "1234", username: "Izuu_X" } });
  });

  test("ignores malformed entries", () => {
    const raw = JSON.stringify([
      { type: "email", address: "not-an-email" },
      { type: "twitter_oauth", username: "no_subject" },
      null,
      "junk",
    ]);
    expect(parseLinkedAccounts(raw)).toEqual({ email: null, x: null });
  });

  test("rejects linked_accounts that is not JSON", () => {
    expect(() => parseLinkedAccounts("{nope")).toThrow(InvalidIdentityTokenError);
  });
});

describe("verifyIdentityToken", () => {
  let fake: Awaited<ReturnType<typeof installFakePrivy>>;
  const saved = { id: process.env.PRIVY_APP_ID, key: process.env.PRIVY_VERIFICATION_KEY };

  beforeAll(async () => {
    fake = await installFakePrivy("app-under-test");
  });

  afterAll(() => {
    process.env.PRIVY_APP_ID = saved.id ?? "";
    process.env.PRIVY_VERIFICATION_KEY = saved.key ?? "";
  });

  test("accepts a token Privy signed for this app", async () => {
    const token = await fake.mint([fake.email("a@b.co")], { sub: "did:privy:1" });
    expect(await verifyIdentityToken(token)).toEqual({ privyUserId: "did:privy:1", email: "a@b.co", x: null });
  });

  test("rejects another app's token", async () => {
    const token = await fake.mint([fake.email("a@b.co")], { aud: "someone-else" });
    await expect(verifyIdentityToken(token)).rejects.toThrow(InvalidIdentityTokenError);
  });

  test("rejects the wrong issuer", async () => {
    const token = await fake.mint([fake.email("a@b.co")], { iss: "evil.example" });
    await expect(verifyIdentityToken(token)).rejects.toThrow(InvalidIdentityTokenError);
  });

  test("rejects an expired token", async () => {
    const token = await fake.mint([fake.email("a@b.co")], { expSeconds: -10 });
    await expect(verifyIdentityToken(token)).rejects.toThrow(InvalidIdentityTokenError);
  });

  test("rejects a token signed by any other key", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const token = await fake.mint([fake.email("a@b.co")], { key: privateKey });
    await expect(verifyIdentityToken(token)).rejects.toThrow(InvalidIdentityTokenError);
  });

  test("rejects a tampered payload", async () => {
    const token = await fake.mint([fake.email("a@b.co")]);
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ sub: "x", iss: "privy.io", aud: "app-under-test", linked_accounts: "[]" }),
    ).toString("base64url");
    await expect(verifyIdentityToken(`${header}.${forged}.${signature}`)).rejects.toThrow(InvalidIdentityTokenError);
  });

  test("rejects garbage", async () => {
    await expect(verifyIdentityToken(undefined)).rejects.toThrow(InvalidIdentityTokenError);
    await expect(verifyIdentityToken("a.b.c")).rejects.toThrow(InvalidIdentityTokenError);
  });

  test("says so when Privy is not configured", async () => {
    const key = process.env.PRIVY_VERIFICATION_KEY;
    process.env.PRIVY_VERIFICATION_KEY = "";
    await expect(verifyIdentityToken("a.b.c")).rejects.toThrow(PrivyNotConfiguredError);
    process.env.PRIVY_VERIFICATION_KEY = key;
  });
});
