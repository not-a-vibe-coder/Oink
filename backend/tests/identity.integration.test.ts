// End-to-end identity flow against a real Postgres: account IDs issued at enrollment, unlock
// and recovery by account ID or tag, the decoy, and the renamed mix routes. Skipped unless
// TEST_DATABASE_URL points at a disposable, migrated database — it writes and deletes rows.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import bs58 from "bs58";
import nacl from "tweetnacl";
import request from "supertest";

// The pool is built when src/db is first imported, possibly by another test file, so the
// database has to be chosen for the whole process: `bun run test:integration`.
const url = process.env.TEST_DATABASE_URL;
const suite = url && process.env.DATABASE_URL === url ? describe : describe.skip;

let app: import("express").Express;
let query: typeof import("../src/db").query;

let base32Decode: typeof import("../src/lib/totp").base32Decode;
let generateHotp: typeof import("../src/lib/totp").generateHotp;

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const keystore = {
  ciphertext: Buffer.alloc(32, 7).toString("base64"),
  nonce: Buffer.alloc(12, 8).toString("base64"),
  kdfSalt: Buffer.alloc(16, 9).toString("base64"),
  kdfParams: { alg: "argon2id", v: 19, m: 65536, t: 3, p: 1, len: 32 },
  cipher: "AES-256-GCM",
  version: 1,
};

// Codes must move forward: the server rejects a step at or below the last one it accepted.
function codeAt(secret: string, offsetSteps: number): string {
  return generateHotp(base32Decode(secret), Math.floor(Date.now() / 30_000) + offsetSteps);
}

function cookieOf(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[];
  return raw[0].split(";")[0];
}

suite("identity flow (integration)", () => {
  const keypair = nacl.sign.keyPair();
  const publicKey = bs58.encode(keypair.publicKey);
  const authKey = Buffer.alloc(32, 1).toString("base64");
  let accountId = "";
  let secret = "";

  beforeAll(async () => {
    ({ app } = await import("../src/app"));
    ({ query } = await import("../src/db"));
    ({ base32Decode, generateHotp } = await import("../src/lib/totp"));
    // enroll/start allows 10 per hour per IP, and every test run comes from 127.0.0.1.
    await query("DELETE FROM rate_limit_hits");
  }, 30_000); // cold imports of the app and pg can outlast the 5s hook default

  afterAll(async () => {
    if (accountId) await query("DELETE FROM wallets WHERE account_id = $1", [accountId]);
    await query("DELETE FROM enrollments WHERE ip_hash IS NOT NULL AND consumed_at IS NULL");
    await query("DELETE FROM login_attempts");
    await query("DELETE FROM auth_challenges");
  });

  test("enroll/start issues an account ID and labels the authenticator with it", async () => {
    const res = await request(app).post("/api/v1/enroll/start").send({}).expect(201);
    expect(res.body.accountId).toMatch(/^oink-[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}$/);
    expect(res.body.otpauthUri).toContain(`Oink:${res.body.accountId}?`);
    accountId = res.body.accountId;
    secret = res.body.totpSecret;

    const done = await request(app)
      .post("/api/v1/enroll/complete")
      .send({ enrollmentId: res.body.enrollmentId, publicKey, keystore, authKey, totpCode: codeAt(secret, 0) })
      .expect(201);
    expect(done.body.accountId).toBe(accountId);
    expect(done.body.tag).toBeNull();
    expect(done.body.mix).toEqual([{ symbol: "USDC", mint: USDC, basisPoints: 10000, percentage: 100 }]);
  });

  test("the same keypair cannot enroll twice", async () => {
    const start = await request(app).post("/api/v1/enroll/start").send({}).expect(201);
    const res = await request(app)
      .post("/api/v1/enroll/complete")
      .send({ enrollmentId: start.body.enrollmentId, publicKey, keystore, authKey, totpCode: codeAt(start.body.totpSecret, 0) })
      .expect(409);
    expect(res.body.error).toBe("WALLET_EXISTS");
  });

  test("unlocks by account ID, in any case", async () => {
    const chl = await request(app).post("/api/v1/auth/challenge").send({ identifier: accountId.toUpperCase() }).expect(200);
    expect(chl.body.accountId).toBe(accountId);
    expect(chl.body.keystore.ciphertext).toBe(keystore.ciphertext);

    const res = await request(app)
      .post("/api/v1/auth/unlock")
      .send({ challengeId: chl.body.challengeId, authKey, totpCode: codeAt(secret, 1) })
      .expect(200);
    expect(res.body).toMatchObject({ accountId, tag: null, publicKey });

    const session = await request(app).get("/api/v1/auth/session").set("Cookie", cookieOf(res)).expect(200);
    expect(session.body.accountId).toBe(accountId);
  });

  test("a wrong authKey is INVALID_CREDENTIALS", async () => {
    const chl = await request(app).post("/api/v1/auth/challenge").send({ identifier: accountId }).expect(200);
    const res = await request(app)
      .post("/api/v1/auth/unlock")
      .send({ challengeId: chl.body.challengeId, authKey: Buffer.alloc(32, 2).toString("base64"), totpCode: "000000" })
      .expect(401);
    expect(res.body.error).toBe("INVALID_CREDENTIALS");
  });

  test("an unknown identifier gets a stable decoy shaped like a real challenge", async () => {
    const a = await request(app).post("/api/v1/auth/challenge").send({ identifier: "oink-zzzz-zzzz" }).expect(200);
    const b = await request(app).post("/api/v1/auth/challenge").send({ identifier: "oink-zzzz-zzzz" }).expect(200);
    expect(a.body.accountId).toMatch(/^oink-[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}$/);
    expect(a.body.accountId).toBe(b.body.accountId);
    expect(a.body.kdfSalt).toBe(b.body.kdfSalt);
    expect(Object.keys(a.body).sort()).toEqual(
      ["accountId", "challengeId", "kdfParams", "kdfSalt", "keystore", "requiresTotp"].sort(),
    );
  });

  test("a tag, once set, unlocks the same account", async () => {
    await query("UPDATE wallets SET tag = 'izuu_test' WHERE account_id = $1", [accountId]);
    const chl = await request(app).post("/api/v1/auth/challenge").send({ identifier: "@Izuu_Test" }).expect(200);
    expect(chl.body.accountId).toBe(accountId);
    const profile = await request(app).get("/api/v1/tags/izuu_test").expect(200);
    expect(profile.body).toMatchObject({ accountId, tag: "izuu_test", publicKey });
  });

  test("recovery signs over the account ID and keeps it", async () => {
    const chl = await request(app).post("/api/v1/auth/recover/challenge").send({ identifier: accountId }).expect(200);
    expect(chl.body.accountId).toBe(accountId);
    expect(chl.body.message).toContain(`Account: ${accountId}`);

    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(chl.body.message), keypair.secretKey));
    const enr = await request(app).post("/api/v1/enroll/start").send({}).expect(201);

    const wrongKey = nacl.sign.keyPair();
    await request(app)
      .post("/api/v1/auth/recover/complete")
      .send({
        challengeId: chl.body.challengeId,
        signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(chl.body.message), wrongKey.secretKey)),
        publicKey: bs58.encode(wrongKey.publicKey),
        keystore,
        authKey,
        totpEnrollmentId: enr.body.enrollmentId,
        totpCode: codeAt(enr.body.totpSecret, 0),
      })
      .expect(401);

    const chl2 = await request(app).post("/api/v1/auth/recover/challenge").send({ identifier: accountId }).expect(200);
    const signature2 = bs58.encode(nacl.sign.detached(new TextEncoder().encode(chl2.body.message), keypair.secretKey));
    expect(signature2).not.toBe(signature);
    const res = await request(app)
      .post("/api/v1/auth/recover/complete")
      .send({
        challengeId: chl2.body.challengeId,
        signature: signature2,
        publicKey,
        keystore,
        authKey,
        totpEnrollmentId: enr.body.enrollmentId,
        totpCode: codeAt(enr.body.totpSecret, 0),
      })
      .expect(200);
    expect(res.body).toMatchObject({ accountId, tag: "izuu_test", publicKey });

    const left = await query("SELECT COUNT(*)::int AS n FROM sessions WHERE account_id = $1 AND revoked_at IS NULL", [accountId]);
    expect(left.rows[0].n).toBe(1);
  });

  test("mix reads by either identifier and writes through the session", async () => {
    // Recovery replaced the authenticator, so open a session directly for the write.
    const { createSession } = await import("../src/middleware/session");
    const { token } = await createSession(accountId);
    const cookie = `oink_session=${token}`;

    const { resolveSolanaToken } = await import("../src/lib/tokens");
    const SPYX = resolveSolanaToken("SPYx")!.mint;
    const bad = await request(app).put("/api/v1/mix").set("Cookie", cookie).send({ mix: [{ mint: USDC, basisPoints: 5000 }] }).expect(400);
    expect(bad.body.error).toBe("MIX_INVALID");

    await request(app)
      .put("/api/v1/mix")
      .set("Cookie", cookie)
      .send({ mix: [{ mint: SPYX, basisPoints: 6000 }, { mint: USDC, basisPoints: 4000 }] })
      .expect(200);

    const byTag = await request(app).get("/api/v1/mix/izuu_test").expect(200);
    const byId = await request(app).get(`/api/v1/mix/${accountId}`).expect(200);
    expect(byTag.body.mix.map((m: { basisPoints: number }) => m.basisPoints)).toEqual([6000, 4000]);
    expect(byId.body).toEqual(byTag.body);
  });
});
