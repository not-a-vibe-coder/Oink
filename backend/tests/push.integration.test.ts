import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import request from "supertest";
import webpush from "web-push";
import { app } from "../src/app";
import { query } from "../src/db";
import { migrate } from "../src/db/migrate";
import { createSession } from "../src/middleware/session";
import { notifyAccount, PUSH_MESSAGES } from "../src/services/push";

const url = process.env.TEST_DATABASE_URL;
const suite = url && url === process.env.DATABASE_URL ? describe : describe.skip;
const account = "oink-pvsh-0000",
  other = "oink-pvsh-0001";
let cookie = "",
  otherCookie = "";
const subscription = (n: number) => ({
  endpoint: `https://push.example.test/send/${n}`,
  keys: {
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
});

suite("Web Push subscriptions (PostgreSQL, mocked push service)", () => {
  beforeAll(async () => {
    await migrate();
    for (const id of [account, other])
      await query(
        "INSERT INTO wallets (account_id,public_key,ciphertext,nonce,kdf_salt,kdf_params,auth_key_hash,totp_secret_enc,totp_nonce) VALUES ($1,$2,'test','test','test','{}','test','test','test')",
        [id, Keypair.generate().publicKey.toBase58()],
      );
    cookie = `oink_session=${(await createSession(account)).token}`;
    otherCookie = `oink_session=${(await createSession(other)).token}`;
  });
  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });
  afterAll(async () => {
    await query("DELETE FROM wallets WHERE account_id = ANY($1)", [[account, other]]);
  });
  const configure = () => {
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = "mailto:ops@oink.example";
    return keys;
  };

  test("migration creates the forward-only table", async () => {
    const applied = await query(
      "SELECT 1 FROM schema_migrations WHERE filename = '011_push_subscriptions.sql'",
    );
    expect(applied.rows.length).toBe(1);
  });

  test("requires a session and configuration; never exposes the private key", async () => {
    await request(app).get("/api/v1/push/config").expect(401);
    await request(app).post("/api/v1/push/subscriptions").send(subscription(1)).expect(401);
    const off = await request(app).get("/api/v1/push/config").set("Cookie", cookie).expect(200);
    expect(off.body).toEqual({ enabled: false, publicKey: null, subscriptions: 0 });
    await request(app)
      .post("/api/v1/push/subscriptions")
      .set("Cookie", cookie)
      .send(subscription(1))
      .expect(503);
    const keys = configure();
    const on = await request(app).get("/api/v1/push/config").set("Cookie", cookie).expect(200);
    expect(on.body.publicKey).toBe(keys.publicKey);
    expect(JSON.stringify(on.body)).not.toContain(keys.privateKey);
  });

  test("validates subscriptions and only notifies opted-in, unrevoked endpoints", async () => {
    configure();
    const sent: { endpoint: string; payload: string }[] = [];
    const spy = spyOn(webpush, "sendNotification").mockImplementation(async (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, payload: String(payload) });
      return { statusCode: 201, body: "", headers: {} };
    });
    try {
      expect(await notifyAccount(account, "payment_received")).toBe(0); // not opted in
      for (const bad of [
        { ...subscription(2), endpoint: "http://push.example.test/x" },
        { ...subscription(2), keys: { p256dh: "not base64!", auth: "x" } },
        {},
      ])
        await request(app)
          .post("/api/v1/push/subscriptions")
          .set("Cookie", cookie)
          .send(bad)
          .expect(400);
      await request(app)
        .post("/api/v1/push/subscriptions")
        .set("Cookie", cookie)
        .send(subscription(2))
        .expect(201);
      expect(await notifyAccount(account, "payment_received")).toBe(1);
      expect(await notifyAccount(other, "payment_received")).toBe(0);
      expect(JSON.parse(sent[0].payload)).toEqual(PUSH_MESSAGES.payment_received);
      // Generic text only: no digits that could be amounts, no addresses or account IDs.
      for (const message of Object.values(PUSH_MESSAGES)) {
        expect(`${message.title} ${message.body}`).not.toMatch(/\d/);
        expect(message.url.startsWith("/app/")).toBe(true);
      }
      // Another account cannot revoke it; the owner can, and then nothing is sent.
      expect(
        (
          await request(app)
            .post("/api/v1/push/subscriptions/revoke")
            .set("Cookie", otherCookie)
            .send({ endpoint: subscription(2).endpoint })
            .expect(200)
        ).body.revoked,
      ).toBe(0);
      expect(
        (
          await request(app)
            .post("/api/v1/push/subscriptions/revoke")
            .set("Cookie", cookie)
            .send({ endpoint: subscription(2).endpoint })
            .expect(200)
        ).body.revoked,
      ).toBe(1);
      expect(await notifyAccount(account, "bell_review")).toBe(0);
      expect(sent.length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("a gone endpoint is revoked; delivery failure never throws", async () => {
    configure();
    await request(app)
      .post("/api/v1/push/subscriptions")
      .set("Cookie", cookie)
      .send(subscription(3))
      .expect(201);
    const spy = spyOn(webpush, "sendNotification").mockImplementation(async () => {
      throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    try {
      expect(await notifyAccount(account, "bell_review")).toBe(0);
      const row = await query("SELECT revoked_at FROM push_subscriptions WHERE endpoint = $1", [
        subscription(3).endpoint,
      ]);
      expect(row.rows[0].revoked_at).not.toBeNull();
      expect(
        (await request(app).get("/api/v1/push/config").set("Cookie", cookie).expect(200)).body
          .subscriptions,
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
