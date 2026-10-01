import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import request from "supertest";
import { app } from "../src/app";
import { query } from "../src/db";
import { migrate } from "../src/db/migrate";
import { createSession } from "../src/middleware/session";
import { USDC } from "../src/lib/tokens";
import { DEFAULT_BELL_POLICY } from "../../src/lib/bell/policy";
import { fixtureBuild } from "./helpers/bell-fixture";
const url = process.env.TEST_DATABASE_URL;
const suite = url && url === process.env.DATABASE_URL ? describe : describe.skip;
const account = "oink-k7p2-9xqp",
  wallet = Keypair.generate().publicKey.toBase58();
const purchase = "purchase_bellquote0000001";
let cookie = "",
  network = process.env.SOLANA_NETWORK;
let restore = () => {};
suite("Bell quote API (PostgreSQL with provider fixtures)", () => {
  beforeAll(async () => {
    await migrate();
    await query(
      "INSERT INTO wallets (account_id,public_key,ciphertext,nonce,kdf_salt,kdf_params,auth_key_hash,totp_secret_enc,totp_nonce) VALUES ($1,$2,'test','test','test','{}','test','test','test')",
      [account, wallet],
    );
    await query(
      "INSERT INTO flow_invoices (id,account_id,recipient_wallet,amount_base,token_mint,reference,signature,receipt_slot,status,expires_at,received_at) VALUES ('bell_quote_invoice',$1,$2,180000000,$3,$4,'bell_quote_income_signature',42,'paid',NOW()+INTERVAL '1 day',NOW())",
      [account, wallet, USDC.mint, Keypair.generate().publicKey.toBase58()],
    );
    await query(
      "INSERT INTO flow_payments (id,invoice_id,account_id,signature,payment_base,cash_base,investment_base,settings_snapshot) VALUES ('bell_quote_payment','bell_quote_invoice',$1,'bell_quote_income_signature',180000000,0,180000000,'{}')",
      [account],
    );
    await query(
      "INSERT INTO flow_purchases (id,payment_id,symbol,amount_base) VALUES ($1,'bell_quote_payment','SPYx',180000000)",
      [purchase],
    );
    cookie = `oink_session=${(await createSession(account)).token}`;
    const mock = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0]) => {
          const requestUrl = new URL(String(input));
          return Response.json(
            fixtureBuild(
              wallet,
              requestUrl.searchParams.get("inputMint")!,
              requestUrl.searchParams.get("outputMint")!,
              requestUrl.searchParams.get("amount")!,
              Number(requestUrl.searchParams.get("slippageBps")),
            ),
          );
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    restore = () => mock.mockRestore();
  }, 30000);
  afterAll(async () => {
    restore();
    if (network === undefined) delete process.env.SOLANA_NETWORK;
    else process.env.SOLANA_NETWORK = network;
    await query("DELETE FROM wallets WHERE account_id=$1", [account]);
  });
  test("requires account ownership and does not quote stock execution on devnet", async () => {
    await request(app).get("/api/v1/flow/purchases").expect(401);
    await request(app)
      .post("/api/v1/flow/purchases/missing/quote")
      .set("Cookie", cookie)
      .send({ policy: DEFAULT_BELL_POLICY })
      .expect(404);
    process.env.SOLANA_NETWORK = "devnet";
    const result = await request(app)
      .post(`/api/v1/flow/purchases/${purchase}/quote`)
      .set("Cookie", cookie)
      .send({ policy: DEFAULT_BELL_POLICY })
      .expect(200);
    expect(result.body.decision.reason).toBe("NETWORK_UNSUPPORTED");
  });
  test("stores passing brief and defers price-limit or required-reference orders", async () => {
    process.env.SOLANA_NETWORK = "mainnet-beta";
    const passing = await request(app)
      .post(`/api/v1/flow/purchases/${purchase}/quote`)
      .set("Cookie", cookie)
      .send({ policy: DEFAULT_BELL_POLICY })
      .expect(200);
    expect(passing.body.decision.status).toBe("pass");
    const limited = await request(app)
      .post(`/api/v1/flow/purchases/${purchase}/quote`)
      .set("Cookie", cookie)
      .send({ policy: { ...DEFAULT_BELL_POLICY, maxTokenPriceBase: "1" } })
      .expect(200);
    expect(limited.body.decision.reason).toBe("PRICE_LIMIT");
    const unavailable = await request(app)
      .post(`/api/v1/flow/purchases/${purchase}/quote`)
      .set("Cookie", cookie)
      .send({ policy: { ...DEFAULT_BELL_POLICY, maxPremiumBps: 50 } })
      .expect(200);
    expect(unavailable.body.decision.reason).toBe("REFERENCE_UNAVAILABLE");
    const list = await request(app).get("/api/v1/flow/purchases").set("Cookie", cookie).expect(200);
    expect(list.body.purchases[0].state).toBe("deferred");
    expect(list.body.purchases[0].quote.id).toBe(unavailable.body.id);
  });
});
