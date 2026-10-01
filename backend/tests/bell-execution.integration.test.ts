import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import request from "supertest";
import bs58 from "bs58";
import { app } from "../src/app";
import { query } from "../src/db";
import { migrate } from "../src/db/migrate";
import { createSession } from "../src/middleware/session";
import { getSolanaConnection } from "../src/services/txBuilder";
import { USDC, resolveSolanaToken } from "../src/lib/tokens";
import { DEFAULT_BELL_POLICY } from "../../src/lib/bell/policy";
import { fixtureBuild } from "./helpers/bell-fixture";
import { pilotReport } from "../scripts/pilot-report";
import type { BellPrepared } from "../../src/lib/bell/types";
const suite =
  process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL === process.env.DATABASE_URL
    ? describe
    : describe.skip;
const account = "oink-k7p2-9xqr",
  signer = Keypair.generate(),
  wallet = signer.publicKey.toBase58(),
  mint = resolveSolanaToken("SPYx")!.mint;
let purchase = "",
  deferredPurchase = "";
let incomeEvidence: ParsedTransactionWithMeta | null = null;
const incomeSignature = bs58.encode(Buffer.alloc(64, 91));
let cookie = "",
  height = 900,
  broadcasts = 0,
  rpcFailure = false,
  failSimulation = false;
let plan: BellPrepared,
  signed = "";
const restores: (() => void)[] = [],
  network = process.env.SOLANA_NETWORK;
function tokenData(mint: string, amount: bigint) {
  const data = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(data);
  signer.publicKey.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return data;
}
function post(path: string, body = {}) {
  return request(app).post(`/api/v1/flow/${path}`).set("Cookie", cookie).send(body);
}
suite("Bell execution lifecycle (PostgreSQL, mocked chain, no spending)", () => {
  beforeAll(async () => {
    process.env.SOLANA_NETWORK = "mainnet-beta";
    await migrate();
    await query(
      "INSERT INTO wallets (account_id,public_key,ciphertext,nonce,kdf_salt,kdf_params,auth_key_hash,totp_secret_enc,totp_nonce) VALUES ($1,$2,'test','test','test','{}','test','test','test')",
      [account, wallet],
    );
    cookie = `oink_session=${(await createSession(account)).token}`;
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0]) => {
          const u = new URL(String(input));
          return Response.json(
            fixtureBuild(
              wallet,
              u.searchParams.get("inputMint")!,
              u.searchParams.get("outputMint")!,
              u.searchParams.get("amount")!,
              Number(u.searchParams.get("slippageBps")),
            ),
          );
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    restores.push(() => fetchMock.mockRestore());
    const rpc = getSolanaConnection();
    const balance = spyOn(rpc, "getParsedTokenAccountsByOwner").mockResolvedValue({
      context: { slot: 100 },
      value: [
        {
          pubkey: Keypair.generate().publicKey,
          account: {
            executable: false,
            lamports: 1,
            owner: TOKEN_PROGRAM_ID,
            rentEpoch: 0,
            data: {
              program: "spl-token",
              space: 165,
              parsed: {
                info: {
                  mint: USDC.mint,
                  owner: wallet,
                  tokenAmount: { amount: "1000000000", decimals: 6 },
                },
              },
            },
          },
        },
      ],
    });
    restores.push(() => balance.mockRestore());
    const accounts = spyOn(rpc, "getMultipleAccountsInfo").mockResolvedValue([
      {
        executable: false,
        lamports: 1000000000,
        owner: SystemProgram.programId,
        rentEpoch: 0,
        data: Buffer.alloc(0),
      },
      {
        executable: false,
        lamports: 1,
        owner: TOKEN_PROGRAM_ID,
        rentEpoch: 0,
        data: tokenData(USDC.mint, 1000000000n),
      },
      {
        executable: false,
        lamports: 1,
        owner: TOKEN_2022_PROGRAM_ID,
        rentEpoch: 0,
        data: tokenData(mint, 0n),
      },
    ]);
    restores.push(() => accounts.mockRestore());
    const simulation = spyOn(rpc, "simulateTransaction").mockImplementation(async () => ({
      context: { slot: 100 },
      value: {
        err: failSimulation ? { InstructionError: [0, "Custom"] } : null,
        logs: [],
        accounts: [
          {
            executable: false,
            lamports: 999995000,
            owner: SystemProgram.programId.toBase58(),
            rentEpoch: 0,
            data: ["", "base64"],
          },
          {
            executable: false,
            lamports: 1,
            owner: TOKEN_PROGRAM_ID.toBase58(),
            rentEpoch: 0,
            data: [tokenData(USDC.mint, 820000000n).toString("base64"), "base64"],
          },
          {
            executable: false,
            lamports: 1,
            owner: TOKEN_2022_PROGRAM_ID.toBase58(),
            rentEpoch: 0,
            data: [tokenData(mint, 18000000n).toString("base64"), "base64"],
          },
        ],
      },
    }));
    restores.push(() => simulation.mockRestore());
    const fee = spyOn(rpc, "getFeeForMessage").mockResolvedValue({
      context: { slot: 100 },
      value: 5000,
    });
    restores.push(() => fee.mockRestore());
    const block = spyOn(rpc, "getBlockHeight").mockImplementation(async () => height);
    restores.push(() => block.mockRestore());
    const send = spyOn(rpc, "sendRawTransaction").mockImplementation(async (bytes) => {
      broadcasts++;
      const signature = bs58.encode(
        VersionedTransaction.deserialize(Uint8Array.from(bytes)).signatures[0],
      );
      expect(
        (
          await query<{ state: string }>("SELECT state FROM bell_attempts WHERE signature=$1", [
            signature,
          ])
        ).rows[0].state,
      ).toBe("submitted");
      throw new Error("Lost broadcast response");
    });
    restores.push(() => send.mockRestore());
    const parsed = spyOn(rpc, "getParsedTransaction").mockImplementation(async (signature) => {
      if (signature === incomeSignature) return incomeEvidence;
      if (rpcFailure) throw new Error("RPC unavailable");
      return null;
    });
    restores.push(() => parsed.mockRestore());
    const status = spyOn(rpc, "getSignatureStatuses").mockResolvedValue({
      context: { slot: 100 },
      value: [null],
    });
    restores.push(() => status.mockRestore());
    await request(app)
      .put("/api/v1/flow/settings")
      .set("Cookie", cookie)
      .send({
        cashTargetBase: "700000000",
        weights: [
          { symbol: "SPYx", basisPoints: 6000 },
          { symbol: "AAPLx", basisPoints: 4000 },
        ],
        revision: 0,
      })
      .expect(200);
    const invoice = await post("invoices", { amountBase: "500000000" }).expect(201);
    incomeEvidence = {
      slot: 42,
      blockTime: Math.ceil(Date.now() / 1000),
      transaction: {
        signatures: [incomeSignature],
        message: {
          accountKeys: [
            { pubkey: new PublicKey(invoice.body.reference), signer: false, writable: false },
          ],
          recentBlockhash: wallet,
          instructions: [],
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
            mint: USDC.mint,
            owner: wallet,
            uiTokenAmount: { amount: "500000000", decimals: 6, uiAmount: null },
          },
        ],
      },
    };
    await post(`invoices/${invoice.body.id}/confirm`, { signature: incomeSignature }).expect(200);
    const allocations = await Promise.all([
      post(`invoices/${invoice.body.id}/allocate`),
      post(`invoices/${invoice.body.id}/allocate`),
    ]);
    expect(allocations.map((result) => result.status)).toEqual([200, 200]);
    expect(allocations[0].body.id).toBe(allocations[1].body.id);
    expect(allocations[0].body.cashBase).toBe("200000000");
    const orders = await request(app)
      .get("/api/v1/flow/purchases")
      .set("Cookie", cookie)
      .expect(200);
    purchase = orders.body.purchases.find((p: { symbol: string }) => p.symbol === "SPYx").id;
    deferredPurchase = orders.body.purchases.find(
      (p: { symbol: string }) => p.symbol === "AAPLx",
    ).id;
    const deferred = await post(`purchases/${deferredPurchase}/quote`, {
      policy: { ...DEFAULT_BELL_POLICY, maxTokenPriceBase: "1" },
    }).expect(200);
    expect(deferred.body.decision.reason).toBe("PRICE_LIMIT");
  }, 30000);
  afterAll(async () => {
    for (const restore of restores.reverse()) restore();
    if (network === undefined) delete process.env.SOLANA_NETWORK;
    else process.env.SOLANA_NETWORK = network;
    await query("DELETE FROM wallets WHERE account_id=$1", [account]);
  });
  test("simulation errors do not create attempts; prepared plans are idempotent", async () => {
    const quote = await post(`purchases/${purchase}/quote`, { policy: DEFAULT_BELL_POLICY }).expect(
      200,
    );
    failSimulation = true;
    await post(`purchases/${purchase}/prepare`, { quoteId: quote.body.id }).expect(409);
    failSimulation = false;
    expect(
      (await query("SELECT id FROM bell_attempts WHERE purchase_id=$1", [purchase])).rows,
    ).toHaveLength(0);
    plan = (await post(`purchases/${purchase}/prepare`, { quoteId: quote.body.id }).expect(200))
      .body;
    expect(plan.attempt.simulation.inputBase).toBe("180000000");
    expect(
      (await post(`purchases/${purchase}/prepare`, { quoteId: quote.body.id }).expect(200)).body
        .attempt.id,
    ).toBe(plan.attempt.id);
    await post(`attempts/${plan.attempt.id}/submit`, {
      signedTransaction: plan.transaction,
    }).expect(400);
    const interrupted = plan;
    await post(`purchases/${purchase}/retry`).expect(200);
    const freshQuote = await post(`purchases/${purchase}/quote`, {
      policy: DEFAULT_BELL_POLICY,
    }).expect(200);
    plan = (
      await post(`purchases/${purchase}/prepare`, { quoteId: freshQuote.body.id }).expect(200)
    ).body;
    expect(plan.attempt.id).not.toBe(interrupted.attempt.id);
    const oldTx = VersionedTransaction.deserialize(Buffer.from(interrupted.transaction, "base64"));
    oldTx.sign([signer]);
    expect(
      (
        await post(`attempts/${interrupted.attempt.id}/submit`, {
          signedTransaction: Buffer.from(oldTx.serialize()).toString("base64"),
        }).expect(200)
      ).body.state,
    ).toBe("superseded");
    expect(broadcasts).toBe(0);
    const tx = VersionedTransaction.deserialize(Buffer.from(plan.transaction, "base64"));
    tx.sign([signer]);
    signed = Buffer.from(tx.serialize()).toString("base64");
  });
  test("persists before broadcast; concurrent duplicates broadcast once", async () => {
    const results = await Promise.all([
      post(`attempts/${plan.attempt.id}/submit`, { signedTransaction: signed }),
      post(`attempts/${plan.attempt.id}/submit`, { signedTransaction: signed }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(broadcasts).toBe(1);
    await post(`purchases/${purchase}/retry`).expect(409);
    await post(`purchases/${purchase}/cancel`).expect(409);
  });
  test("RPC outage cannot release reservations; proved expiry permits explicit retry", async () => {
    rpcFailure = true;
    await post(`attempts/${plan.attempt.id}/reconcile`).expect(503);
    rpcFailure = false;
    await post(`purchases/${purchase}/retry`).expect(409);
    expect((await post(`attempts/${plan.attempt.id}/reconcile`).expect(200)).body.state).toBe(
      "submitted",
    );
    height = 1001;
    expect((await post(`attempts/${plan.attempt.id}/reconcile`).expect(200)).body.state).toBe(
      "expired",
    );
    await post(`purchases/${purchase}/retry`).expect(200);
    height = 900;
    const quote = await post(`purchases/${purchase}/quote`, { policy: DEFAULT_BELL_POLICY }).expect(
      200,
    );
    const next = await post(`purchases/${purchase}/prepare`, { quoteId: quote.body.id }).expect(
      200,
    );
    expect(next.body.attempt.id).not.toBe(plan.attempt.id);
    const tx = VersionedTransaction.deserialize(Buffer.from(next.body.transaction, "base64"));
    tx.sign([signer]);
    await post(`attempts/${next.body.attempt.id}/submit`, {
      signedTransaction: Buffer.from(tx.serialize()).toString("base64"),
    }).expect(200);
    const signature = bs58.encode(tx.signatures[0]);
    const balance = (token: string, amount: string, accountIndex: number) => ({
      mint: token,
      owner: wallet,
      accountIndex,
      uiTokenAmount: {
        amount,
        decimals: token === USDC.mint ? 6 : 8,
        uiAmount: null,
        uiAmountString: "0",
      },
    });
    const finalized: ParsedTransactionWithMeta = {
      slot: 100,
      blockTime: null,
      transaction: {
        signatures: [signature],
        message: {
          accountKeys: [{ pubkey: signer.publicKey, signer: true, writable: true }],
          recentBlockhash: wallet,
          instructions: [],
        },
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1000000000],
        postBalances: [999995000],
        preTokenBalances: [balance(USDC.mint, "1000000000", 1), balance(mint, "0", 2)],
        postTokenBalances: [balance(USDC.mint, "820000000", 1), balance(mint, "18000000", 2)],
      },
    };
    const parsed = spyOn(getSolanaConnection(), "getParsedTransaction").mockResolvedValue(
      finalized,
    );
    const settled = await post(`attempts/${next.body.attempt.id}/reconcile`).expect(200);
    expect(settled.body.state).toBe("confirmed");
    expect(settled.body.receipt.withinLimits).toBe(true);
    expect(
      (await post(`attempts/${next.body.attempt.id}/reconcile`).expect(200)).body.receipt,
    ).toEqual(settled.body.receipt);
    parsed.mockRestore();
    await post(`purchases/${purchase}/retry`).expect(409);
    await post(`purchases/${purchase}/cancel`).expect(409);
    await post(`purchases/${deferredPurchase}/cancel`).expect(200);
    await post(`purchases/${deferredPurchase}/cancel`).expect(200);
    const history = await request(app)
      .get("/api/v1/flow/receipts")
      .set("Cookie", cookie)
      .expect(200);
    expect(history.body.attempts).toHaveLength(3);
    expect(history.body.attempts.some((a: { state: string }) => a.state === "expired")).toBe(true);
    const report = await pilotReport([account]);
    expect(report.received_payments).toBe("1");
    expect(report.allocated_payments).toBe("1");
    expect(report.allocated_usdc_base).toBe("500000000");
    expect(report.cash_allocation_base).toBe("200000000");
    expect(report.finalized_fills).toBe("1");
    expect(report.actual_usdc_spent_base).toBe("180000000");
    expect(report.released_usdc_base).toBe("120000000");
    expect(report.reserved_usdc_base).toBe("0");
    expect(report.finalized_fee_lamports).toBe("5000");
    expect(report.repeat_users).toBe("0");
  });
});
