import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Keypair, PublicKey, Transaction, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import request from "supertest";
import webpush from "web-push";
import { app } from "../src/app";
import { query } from "../src/db";
import { migrate } from "../src/db/migrate";
import { createSession } from "../src/middleware/session";
import { getSolanaConnection } from "../src/services/txBuilder";
const url = process.env.TEST_DATABASE_URL;
const suite = url && url === process.env.DATABASE_URL ? describe : describe.skip;
const account = "oink-k7p2-9xqm";
const other = "oink-k7p2-9xqn";
const wallet = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey.toBase58();
let balance = 1300000000n;
let rpcDown = false;
let cookie = "";
let otherCookie = "";
let sequence = 6;
const evidence = new Map<string, ParsedTransactionWithMeta>();
let restore: (() => void)[] = [];
async function makeInvoice(amountBase = "500000000") {
  const response = await request(app)
    .post("/api/v1/flow/invoices")
    .set("Cookie", cookie)
    .send({ amountBase })
    .expect(201);
  return response.body as { id: string; reference: string; solanaPayUri: string };
}
function proof(reference: string, amount = "500000000") {
  const signature = bs58.encode(Buffer.alloc(64, ++sequence));
  const tx: ParsedTransactionWithMeta = {
    slot: 42,
    blockTime: Math.ceil(Date.now() / 1000),
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [{ pubkey: new PublicKey(reference), signer: false, writable: false }],
        instructions: [],
        recentBlockhash: "",
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [],
      postBalances: [],
      preTokenBalances: [],
      postTokenBalances: [
        {
          accountIndex: 0,
          mint,
          owner: wallet,
          uiTokenAmount: { amount, decimals: 6, uiAmount: null },
        },
      ],
    },
  };
  evidence.set(signature, tx);
  return signature;
}
suite("Flow database and HTTP integration (RPC fixtures)", () => {
  beforeAll(async () => {
    process.env.FLOW_USDC_MINT = mint;
    await migrate();
    // Rate-limit hits persist in the (disposable) test database; reruns within an hour
    // would otherwise exhaust the confirm limit and fail for reasons unrelated to the test.
    await query("DELETE FROM rate_limit_hits WHERE bucket LIKE 'flow_%'");
    for (const [id, key] of [
      [account, wallet],
      [other, Keypair.generate().publicKey.toBase58()],
    ]) {
      await query(
        "INSERT INTO wallets (account_id,public_key,ciphertext,nonce,kdf_salt,kdf_params,auth_key_hash,totp_secret_enc,totp_nonce) VALUES ($1,$2,'test','test','test','{}','test','test','test')",
        [id, key],
      );
    }
    cookie = `oink_session=${(await createSession(account)).token}`;
    otherCookie = `oink_session=${(await createSession(other)).token}`;
    const connection = getSolanaConnection();
    const transactions = spyOn(connection, "getParsedTransaction").mockImplementation(
      async (signature) => evidence.get(signature) ?? null,
    );
    const balances = spyOn(connection, "getParsedTokenAccountsByOwner").mockImplementation(
      async () => {
        if (rpcDown) throw new Error("rpc down");
        return {
          context: { slot: 43 },
          value: [
            {
              pubkey: Keypair.generate().publicKey,
              account: {
                executable: false,
                owner: PublicKey.default,
                lamports: 0,
                rentEpoch: 0,
                data: {
                  program: "spl-token",
                  space: 165,
                  parsed: {
                    info: {
                      mint,
                      owner: wallet,
                      tokenAmount: { decimals: 6, amount: balance.toString() },
                    },
                  },
                },
              },
            },
          ],
        };
      },
    );
    restore = [() => transactions.mockRestore(), () => balances.mockRestore()];
  }, 30000);
  afterAll(async () => {
    restore.forEach((work) => work());
    await query("DELETE FROM wallets WHERE account_id = ANY($1)", [[account, other]]);
    delete process.env.FLOW_USDC_MINT;
  });
  test("requires a session and rejects stale or invalid settings", async () => {
    await request(app).get("/api/v1/flow/settings").expect(401);
    await request(app)
      .post("/api/v1/flow/invoices")
      .set("Cookie", cookie)
      .send({ amountBase: "18446744073709551616" })
      .expect(400);
    await request(app)
      .put("/api/v1/flow/settings")
      .set("Cookie", cookie)
      .send({ cashTargetBase: "0", weights: [{ symbol: "SPYx", basisPoints: 9999 }], revision: 0 })
      .expect(400);
    await request(app)
      .put("/api/v1/flow/settings")
      .set("Cookie", cookie)
      .send({
        cashTargetBase: "1000000000",
        weights: [
          { symbol: "SPYx", basisPoints: 6000 },
          { symbol: "AAPLx", basisPoints: 4000 },
        ],
        revision: 0,
      })
      .expect(200);
    await request(app)
      .put("/api/v1/flow/settings")
      .set("Cookie", cookie)
      .send({ cashTargetBase: "0", weights: [], revision: 0 })
      .expect(409);
  });
  test("payment is verified separately, then concurrent allocation is idempotent", async () => {
    const invoice = await makeInvoice();
    expect(invoice.solanaPayUri).toContain(`reference=${invoice.reference}`);
    await request(app)
      .post(`/api/v1/flow/invoices/${invoice.id}/allocate`)
      .set("Cookie", cookie)
      .expect(409);
    await request(app)
      .post(`/api/v1/flow/invoices/${invoice.id}/confirm`)
      .send({ signature: proof(invoice.reference, "499") })
      .expect(409);
    const signature = proof(invoice.reference);
    await request(app)
      .post(`/api/v1/flow/invoices/${invoice.id}/confirm`)
      .send({ signature })
      .expect(200);
    await request(app)
      .post(`/api/v1/flow/invoices/${invoice.id}/allocate`)
      .set("Cookie", otherCookie)
      .expect(404);
    const results = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post(`/api/v1/flow/invoices/${invoice.id}/allocate`)
          .set("Cookie", cookie)
          .expect(200),
      ),
    );
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(results[0].body.cashBase).toBe("200000000");
    expect(results[0].body.investmentBase).toBe("300000000");
    expect((await query("SELECT COUNT(*)::int AS count FROM flow_purchases")).rows[0].count).toBe(
      2,
    );
    expect(
      (
        await request(app)
          .post(`/api/v1/flow/invoices/${invoice.id}/confirm`)
          .send({ signature })
          .expect(200)
      ).body.status,
    ).toBe("paid");
  });
  test("distinct concurrent income allocations reserve each payment exactly once", async () => {
    balance = 2300000000n;
    const invoices = await Promise.all([makeInvoice(), makeInvoice()]);
    for (const invoice of invoices)
      await request(app)
        .post(`/api/v1/flow/invoices/${invoice.id}/confirm`)
        .send({ signature: proof(invoice.reference) })
        .expect(200);
    const results = await Promise.all(
      invoices.map((invoice) =>
        request(app)
          .post(`/api/v1/flow/invoices/${invoice.id}/allocate`)
          .set("Cookie", cookie)
          .expect(200),
      ),
    );
    expect(results.every((result) => result.body.investmentBase === "500000000")).toBe(true);
    const totals = await query("SELECT SUM(amount_base)::text AS amount FROM flow_purchases");
    expect(totals.rows[0].amount).toBe("1300000000");
  });
  test("insufficient backing leaves receipt intact and cannot create purchase intents", async () => {
    const invoice = await makeInvoice();
    await request(app)
      .post(`/api/v1/flow/invoices/${invoice.id}/confirm`)
      .send({ signature: proof(invoice.reference) })
      .expect(200);
    balance = 1n;
    await request(app)
      .post(`/api/v1/flow/invoices/${invoice.id}/allocate`)
      .set("Cookie", cookie)
      .expect(409);
    expect(
      (await request(app).get(`/api/v1/flow/invoices/${invoice.id}`).expect(200)).body.status,
    ).toBe("paid");
    expect(
      (
        await query("SELECT COUNT(*)::int AS count FROM flow_payments WHERE invoice_id=$1", [
          invoice.id,
        ])
      ).rows[0].count,
    ).toBe(0);
  });
  test("summary reports the payday plan and next action without a session leak", async () => {
    await request(app).get("/api/v1/flow/summary").expect(401);
    balance = 1300000000n;
    const summary = (
      await request(app).get("/api/v1/flow/summary").set("Cookie", cookie).expect(200)
    ).body;
    expect(summary.planConfigured).toBe(true);
    expect(summary.orders.pending).toBe(6);
    // One paid invoice was left unallocated by the insufficient-backing test above.
    expect(summary.unallocatedPayments).toBe(1);
    expect(summary.nextAction).toBe("allocate");
    expect(summary.reserve).toEqual({
      status: "available",
      targetBase: "1000000000",
      availableBase: "0",
      filledBase: "0",
      progressBps: 0,
    });
    const other = (
      await request(app).get("/api/v1/flow/summary").set("Cookie", otherCookie).expect(200)
    ).body;
    expect(other.planConfigured).toBe(false);
    expect(other.orders.pending).toBe(0);
    expect(other.nextAction).toBe("set_plan");
  });
  test("summary fails closed when the balance cannot be read", async () => {
    // Flip the suite-wide balance mock rather than re-spying: restoring a nested spy would
    // remove the outer mock and send later balance reads to a real RPC.
    rpcDown = true;
    try {
      const summary = (
        await request(app).get("/api/v1/flow/summary").set("Cookie", cookie).expect(200)
      ).body;
      expect(summary.reserve.status).toBe("unavailable");
      expect(summary.reserve.progressBps).toBeNull();
    } finally {
      rpcDown = false;
    }
  });
  test("payer wallets get an unsigned referenced transfer; top-ups need a session", async () => {
    const connection = getSolanaConnection();
    const mintData = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 0,
        mintAuthority: PublicKey.default,
        supply: 0n,
        decimals: 6,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      mintData,
    );
    const spies = [
      spyOn(connection, "getAccountInfo").mockResolvedValue({
        data: mintData,
        owner: TOKEN_PROGRAM_ID,
        lamports: 1,
        executable: false,
        rentEpoch: 0,
      }),
      spyOn(connection, "getTokenAccountBalance").mockResolvedValue({
        context: { slot: 1 },
        value: { amount: "900000000", decimals: 6, uiAmount: null },
      }),
      spyOn(connection, "getLatestBlockhash").mockResolvedValue({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 100,
      }),
    ];
    try {
      const payer = Keypair.generate().publicKey.toBase58();
      const invoice = await makeInvoice();
      const built = (
        await request(app)
          .post(`/api/v1/flow/invoices/${invoice.id}/transaction`)
          .send({ account: payer })
          .expect(200)
      ).body;
      const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
      const message = tx.compileMessage();
      expect(message.accountKeys.filter((_, i) => message.isAccountSigner(i)).map(String)).toEqual([
        payer,
      ]);
      const ref = message.accountKeys.findIndex((key) => key.toBase58() === invoice.reference);
      expect(ref).toBeGreaterThan(-1);
      expect(message.isAccountWritable(ref)).toBe(false);
      await request(app)
        .post(`/api/v1/flow/invoices/${invoice.id}/transaction`)
        .send({ account: wallet })
        .expect(400);
      await request(app)
        .post(`/api/v1/flow/invoices/${invoice.id}/confirm`)
        .send({ signature: proof(invoice.reference) })
        .expect(200);
      await request(app)
        .post(`/api/v1/flow/invoices/${invoice.id}/transaction`)
        .send({ account: payer })
        .expect(409);
      await request(app)
        .post("/api/v1/flow/topup/transaction")
        .send({ payer, lamports: "1000" })
        .expect(401);
      const topup = (
        await request(app)
          .post("/api/v1/flow/topup/transaction")
          .set("Cookie", cookie)
          .send({ payer, usdcBase: "1000000", lamports: "1000" })
          .expect(200)
      ).body;
      const topupTx = Transaction.from(Buffer.from(topup.transaction, "base64"));
      expect(topupTx.feePayer?.toBase58()).toBe(payer);
      await request(app)
        .post("/api/v1/flow/topup/transaction")
        .set("Cookie", cookie)
        .send({ payer, usdcBase: "1.5" })
        .expect(400);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
  test("first confirmation and first allocation each notify an opted-in account once", async () => {
    const keys = webpush.generateVAPIDKeys();
    Object.assign(process.env, {
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: "mailto:ops@oink.example",
    });
    const sent: string[] = [];
    const spy = spyOn(webpush, "sendNotification").mockImplementation(async (_sub, payload) => {
      sent.push(JSON.parse(String(payload)).title);
      return { statusCode: 201, body: "", headers: {} };
    });
    try {
      await query(
        "INSERT INTO push_subscriptions (id,account_id,endpoint,p256dh,auth) VALUES ('push_flowtest000001',$1,'https://push.example.test/flow','BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM','tBHItJI5svbpez7KI4CCXg')",
        [account],
      );
      balance = 10_000_000_000n;
      const invoice = await makeInvoice();
      const signature = proof(invoice.reference);
      for (let i = 0; i < 2; i++)
        await request(app)
          .post(`/api/v1/flow/invoices/${invoice.id}/confirm`)
          .send({ signature })
          .expect(200);
      for (let i = 0; i < 2; i++) {
        const allocated = await request(app)
          .post(`/api/v1/flow/invoices/${invoice.id}/allocate`)
          .set("Cookie", cookie);
        expect(allocated.body).toMatchObject({ invoiceId: invoice.id });
      }
      await Bun.sleep(50);
      expect(sent).toEqual(["Payment received", "Bell order needs review"]);
    } finally {
      spy.mockRestore();
      await query("DELETE FROM push_subscriptions WHERE id = 'push_flowtest000001'");
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      delete process.env.VAPID_SUBJECT;
    }
  });
  test("database rejects signature reuse and non-conserving payments", async () => {
    const invoice = await makeInvoice();
    const prior = (await query("SELECT signature FROM flow_invoices WHERE status='paid' LIMIT 1"))
      .rows[0].signature;
    await expect(
      query(
        "UPDATE flow_invoices SET status='paid', signature=$2, receipt_slot=42, received_at=NOW() WHERE id=$1",
        [invoice.id, prior],
      ),
    ).rejects.toThrow();
    await expect(
      query(
        "INSERT INTO flow_payments (id,invoice_id,account_id,signature,payment_base,cash_base,investment_base,settings_snapshot) VALUES ('invalid',$1,$2,'unique-test',100,10,10,'{}')",
        [invoice.id, account],
      ),
    ).rejects.toThrow();
  });
});
