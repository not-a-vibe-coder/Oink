// Linking email and X, tag claiming through X, and the admin API, against a real Postgres.
// Skipped unless TEST_DATABASE_URL points at a disposable, migrated database.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import request from "supertest";
import { installFakePrivy } from "./helpers/privyTokens";

// The pool is built when src/db is first imported, possibly by another test file, so the
// database has to be chosen for the whole process: `bun run test:integration`.
const url = process.env.TEST_DATABASE_URL;
const suite = url && process.env.DATABASE_URL === url ? describe : describe.skip;

suite("linking and admin (integration)", () => {
  let app: import("express").Express;
  let query: typeof import("../src/db").query;

  let fake: Awaited<ReturnType<typeof installFakePrivy>>;
  const accounts: Record<string, { id: string; cookie: string }> = {};
  const run = Math.random().toString(36).slice(2, 7);
  const adminEmail = `boss-${run}@oink.test`;

  async function makeWallet(name: string, tag: string | null = null) {
    const { generateAccountId } = await import("../src/lib/accountId");
    const { createSession } = await import("../src/middleware/session");
    const id = generateAccountId();
    await query(
      `INSERT INTO wallets (account_id, tag, public_key, ciphertext, nonce, kdf_salt, kdf_params, auth_key_hash, totp_secret_enc, totp_nonce)
       VALUES ($1, $2, $3, 'c', 'n', 's', '{}', 'h', 't', 'tn')`,
      [id, tag, `PK_${name}_${run}`],
    );
    const { token } = await createSession(id);
    accounts[name] = { id, cookie: `oink_session=${token}` };
  }

  beforeAll(async () => {
    process.env.ADMIN_EMAILS = `${adminEmail}, other-admin@oink.test`;
    fake = await installFakePrivy();
    ({ app } = await import("../src/app"));
    ({ query } = await import("../src/db"));
    await query("DELETE FROM rate_limit_hits");
    await makeWallet("alice");
    await makeWallet("bob");
    await makeWallet("squatter", `izuu${run}`);
  }, 30_000); // cold imports of the app and pg can outlast the 5s hook default

  afterAll(async () => {
    const ids = Object.values(accounts).map((a) => a.id);
    await query("DELETE FROM account_events WHERE account_id = ANY($1)", [ids]);
    await query("DELETE FROM wallets WHERE account_id = ANY($1)", [ids]);
    await query("DELETE FROM admin_sessions WHERE email = $1", [adminEmail]);
    await query("DELETE FROM admin_audit WHERE admin_email = $1", [adminEmail]);
    await query("DELETE FROM admin_reviews WHERE admin_email = $1", [adminEmail]);
    await query("DELETE FROM rate_limit_hits");
  });

  // ── email ──

  test("links a verified email, lowercased", async () => {
    const token = await fake.mint([fake.email(`Alice-${run}@Example.com`)]);
    const res = await request(app).post("/api/v1/identity/email").set("Cookie", accounts.alice.cookie).send({ identityToken: token }).expect(200);
    expect(res.body.email).toBe(`alice-${run}@example.com`);
    const session = await request(app).get("/api/v1/auth/session").set("Cookie", accounts.alice.cookie).expect(200);
    expect(session.body.email).toBe(`alice-${run}@example.com`);
  });

  test("an email already linked elsewhere is refused", async () => {
    const token = await fake.mint([fake.email(`alice-${run}@example.com`)]);
    const res = await request(app).post("/api/v1/identity/email").set("Cookie", accounts.bob.cookie).send({ identityToken: token }).expect(409);
    expect(res.body.error).toBe("EMAIL_TAKEN");
  });

  test("a forged or foreign token links nothing", async () => {
    const foreign = await fake.mint([fake.email(`x-${run}@example.com`)], { aud: "not-our-app" });
    const res = await request(app).post("/api/v1/identity/email").set("Cookie", accounts.bob.cookie).send({ identityToken: foreign }).expect(401);
    expect(res.body.error).toBe("INVALID_IDENTITY");
  });

  test("linking needs a wallet session", async () => {
    const token = await fake.mint([fake.email(`y-${run}@example.com`)]);
    await request(app).post("/api/v1/identity/email").send({ identityToken: token }).expect(401);
  });

  test("unlinking frees the email for another wallet", async () => {
    await request(app).delete("/api/v1/identity/email").set("Cookie", accounts.alice.cookie).expect(200);
    const token = await fake.mint([fake.email(`alice-${run}@example.com`)]);
    const res = await request(app).post("/api/v1/identity/email").set("Cookie", accounts.bob.cookie).send({ identityToken: token }).expect(200);
    expect(res.body.email).toBe(`alice-${run}@example.com`);
  });

  // ── X and tags ──

  test("linking X claims the username as the tag", async () => {
    const token = await fake.mint([fake.x(`x-alice-${run}`, `Alice${run}`)]);
    const res = await request(app).post("/api/v1/identity/x").set("Cookie", accounts.alice.cookie).send({ identityToken: token }).expect(200);
    expect(res.body).toMatchObject({ tag: `alice${run}`, x: { username: `Alice${run}` }, tagOutcome: "assigned" });
  });

  test("the X owner takes the tag from a wallet that holds it without owning the handle", async () => {
    const token = await fake.mint([fake.x(`x-izuu-${run}`, `izuu${run}`)]);
    const res = await request(app).post("/api/v1/identity/x").set("Cookie", accounts.bob.cookie).send({ identityToken: token }).expect(200);
    expect(res.body.tag).toBe(`izuu${run}`);
    const squatter = await query("SELECT tag FROM wallets WHERE account_id = $1", [accounts.squatter.id]);
    expect(squatter.rows[0].tag).toBeNull();
    const lost = await query("SELECT detail FROM account_events WHERE account_id = $1 AND kind = 'tag_lost'", [accounts.squatter.id]);
    expect(lost.rows[0].detail).toMatchObject({ tag: `izuu${run}` });
  });

  test("one X account cannot back two wallets", async () => {
    const token = await fake.mint([fake.x(`x-alice-${run}`, `Alice${run}`)]);
    const res = await request(app).post("/api/v1/identity/x").set("Cookie", accounts.squatter.cookie).send({ identityToken: token }).expect(409);
    expect(res.body.error).toBe("X_TAKEN");
  });

  test("a reserved or too-short handle links X but gives no tag", async () => {
    const token = await fake.mint([fake.x(`x-short-${run}`, "ab")]);
    const res = await request(app).post("/api/v1/identity/x").set("Cookie", accounts.squatter.cookie).send({ identityToken: token }).expect(200);
    expect(res.body).toMatchObject({ tag: null, x: { username: "ab" }, tagOutcome: "invalid" });
  });

  test("unlinking X keeps the tag", async () => {
    const res = await request(app).delete("/api/v1/identity/x").set("Cookie", accounts.alice.cookie).expect(200);
    expect(res.body).toMatchObject({ tag: `alice${run}`, x: null });
  });

  // ── admin ──

  let adminCookie = "";

  test("a wallet session is not an admin session", async () => {
    await request(app).get("/api/v1/admin/overview").set("Cookie", accounts.alice.cookie).expect(401);
  });

  test("a verified email that is not on the list is refused", async () => {
    const token = await fake.mint([fake.email(`alice-${run}@example.com`)]);
    const res = await request(app).post("/api/v1/admin/login").send({ identityToken: token }).expect(403);
    expect(res.body.error).toBe("FORBIDDEN");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  test("an X-only sign-in cannot become an admin", async () => {
    const token = await fake.mint([fake.x("1", "boss")]);
    await request(app).post("/api/v1/admin/login").send({ identityToken: token }).expect(403);
  });

  test("a listed email signs in, case-insensitively", async () => {
    const token = await fake.mint([fake.email(adminEmail.toUpperCase())]);
    const res = await request(app).post("/api/v1/admin/login").send({ identityToken: token }).expect(200);
    expect(res.body.email).toBe(adminEmail);
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    adminCookie = cookie.split(";")[0];
  });

  test("overview counts wallets and linked identities", async () => {
    const res = await request(app).get("/api/v1/admin/overview").set("Cookie", adminCookie).expect(200);
    expect(res.body.wallets).toBeGreaterThanOrEqual(3);
    expect(res.body.emails_linked).toBeGreaterThanOrEqual(1);
    expect(res.body.x_linked).toBeGreaterThanOrEqual(2);
  });

  test("the activity feed shows linking and can be reviewed and flagged", async () => {
    const feed = await request(app).get("/api/v1/admin/activity").set("Cookie", adminCookie).query({ limit: 100 }).expect(200);
    const lost = feed.body.items.find((i: any) => i.kind === "tag_lost" && i.account_id === accounts.squatter.id);
    expect(lost).toBeDefined();

    await request(app).post("/api/v1/admin/reviews").set("Cookie", adminCookie)
      .send({ source: lost.source, sourceId: lost.id, status: "flagged", note: "check this" }).expect(200);
    const flagged = await request(app).get("/api/v1/admin/activity").set("Cookie", adminCookie).query({ filter: "flagged" }).expect(200);
    expect(flagged.body.items.some((i: any) => i.id === lost.id && i.review_note === "check this")).toBe(true);

    await request(app).post("/api/v1/admin/reviews").set("Cookie", adminCookie)
      .send({ source: lost.source, sourceId: lost.id, status: "clear" }).expect(200);
    const after = await request(app).get("/api/v1/admin/activity").set("Cookie", adminCookie).query({ filter: "flagged" }).expect(200);
    expect(after.body.items.some((i: any) => i.id === lost.id)).toBe(false);

    await request(app).post("/api/v1/admin/reviews").set("Cookie", adminCookie)
      .send({ source: "wallets", sourceId: 1, status: "flagged" }).expect(400);
  });

  test("the database viewer never returns secret columns", async () => {
    const wallets = await request(app).get("/api/v1/admin/tables/wallets").set("Cookie", adminCookie).expect(200);
    for (const secret of ["ciphertext", "nonce", "kdf_salt", "auth_key_hash", "totp_secret_enc", "totp_nonce"]) {
      expect(wallets.body.columns).not.toContain(secret);
      expect(wallets.body.hiddenColumns).toContain(secret);
      for (const row of wallets.body.rows) expect(row).not.toHaveProperty(secret);
    }
    expect(wallets.body.columns).toContain("account_id");

    const sessions = await request(app).get("/api/v1/admin/tables/sessions").set("Cookie", adminCookie).expect(200);
    for (const row of sessions.body.rows) expect(row).not.toHaveProperty("token_hash");

    await request(app).get("/api/v1/admin/tables/pg_authid").set("Cookie", adminCookie).expect(404);
    await request(app).get("/api/v1/admin/tables/wallets;DROP TABLE wallets").set("Cookie", adminCookie).expect(404);

    const audit = await query("SELECT action, detail FROM admin_audit WHERE admin_email = $1 AND action = 'table_read'", [adminEmail]);
    expect(audit.rows.map((r) => r.detail.table)).toEqual(expect.arrayContaining(["wallets", "sessions"]));
  });

  test("removing an address from ADMIN_EMAILS locks its session out at once", async () => {
    const saved = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "other-admin@oink.test";
    await request(app).get("/api/v1/admin/me").set("Cookie", adminCookie).expect(401);
    process.env.ADMIN_EMAILS = saved;
    await request(app).get("/api/v1/admin/me").set("Cookie", adminCookie).expect(200);
  });

  test("logout revokes the admin session", async () => {
    await request(app).post("/api/v1/admin/logout").set("Cookie", adminCookie).expect(204);
    await request(app).get("/api/v1/admin/me").set("Cookie", adminCookie).expect(401);
  });

  // ── rate limits ──

  test("admin login is rate limited per IP", async () => {
    const token = await fake.mint([fake.email(`nobody-${run}@example.com`)]);
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await request(app).post("/api/v1/admin/login").set("X-Forwarded-For", `198.51.100.${run.length}`).send({ identityToken: token })).status;
    }
    expect(last).toBe(429);
  });
});
