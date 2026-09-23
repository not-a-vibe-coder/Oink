// Held payments end to end against a real Postgres, with Privy and the chain replaced by
// fakes that record what they were asked to do. Skipped unless run with
// `bun run test:integration` against a disposable, migrated database.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import request from "supertest";
import { installFakePrivy } from "./helpers/privyTokens";
import type { HoldingProvider, HeldIdentity } from "../src/services/held/provider";
import type { ReleaseChain } from "../src/services/held/chain";

const url = process.env.TEST_DATABASE_URL;
const suite = url && process.env.DATABASE_URL === url ? describe : describe.skip;

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

class FakeProvider implements HoldingProvider {
  created: HeldIdentity[] = [];
  allowed = new Map<string, string[]>();
  signed: string[] = [];
  async createHoldingWallet(identity: HeldIdentity) {
    this.created.push(identity);
    const n = this.created.length;
    return {
      privyUserId: `did:privy:held-${n}`,
      walletId: `wallet-${n}-${Math.random().toString(36).slice(2, 8)}`,
      address: Keypair.generate().publicKey.toBase58(),
      policyId: `policy-${n}`,
      ruleId: `rule-${n}`,
    };
  }
  async setAllowedDestinations(wallet: { policyId: string }, destinations: string[]) {
    this.allowed.set(wallet.policyId, destinations);
  }
  async signTransaction(walletId: string, tx: string) {
    this.signed.push(walletId);
    return tx;
  }
}

class FakeChain implements ReleaseChain {
  releases: Array<{ holdingWallet: string; destination: string; amountBase: bigint }> = [];
  failBuild = false;
  broadcastResult: "confirmed" | "failed" | "throw" = "confirmed";
  outcomeResult: "confirmed" | "failed" | "pending" | "expired" = "confirmed";
  async ensureTokenAccount(owner: string, mint: string) {
    return `ata(${owner.slice(0, 8)},${mint.slice(0, 4)})`;
  }
  async buildRelease(input: { holdingWallet: string; destination: string; amountBase: bigint; sign: (b: string) => Promise<string> }) {
    if (this.failBuild) throw new Error("simulated build failure");
    await input.sign("dW5zaWduZWQ=");
    this.releases.push({ holdingWallet: input.holdingWallet, destination: input.destination, amountBase: input.amountBase });
    return { signature: `sig-${Math.random().toString(36).slice(2)}`, lastValidBlockHeight: 1000, raw: new Uint8Array([1]) };
  }
  async broadcast() {
    if (this.broadcastResult === "throw") throw new Error("connection dropped");
    return this.broadcastResult;
  }
  async outcome() {
    return this.outcomeResult;
  }
}

suite("held payments (integration)", () => {
  let app: import("express").Express;
  let query: typeof import("../src/db").query;
  let held: typeof import("../src/services/held/heldPayments");
  let fake: Awaited<ReturnType<typeof installFakePrivy>>;
  const provider = new FakeProvider();
  const chain = new FakeChain();
  const run = Math.random().toString(36).slice(2, 7);
  const izuuEmail = `izuu-${run}@example.com`;
  const accounts: Record<string, { id: string; cookie: string; publicKey: string }> = {};

  async function makeWallet(name: string) {
    const { generateAccountId } = await import("../src/lib/accountId");
    const { createSession } = await import("../src/middleware/session");
    const id = generateAccountId();
    const publicKey = Keypair.generate().publicKey.toBase58();
    await query(
      `INSERT INTO wallets (account_id, public_key, ciphertext, nonce, kdf_salt, kdf_params, auth_key_hash, totp_secret_enc, totp_nonce)
       VALUES ($1, $2, 'c', 'n', 's', '{}', 'h', 't', 'tn')`,
      [id, publicKey],
    );
    const { token } = await createSession(id);
    accounts[name] = { id, cookie: `oink_session=${token}`, publicKey };
  }

  async function deposit(to: string, amountBase: bigint, sender = accounts.pascal) {
    const wallet = await held.ensureHoldingWallet({ kind: "email", email: to });
    return held.recordHeldDeposit({
      heldWalletAddress: wallet.address,
      senderAccountId: sender.id,
      senderWallet: sender.publicKey,
      mint: USDC,
      symbol: "USDC",
      decimals: 6,
      amountBase,
      signature: `deposit-${Math.random().toString(36).slice(2)}`,
    });
  }

  const statusOf = async (id: number) => (await query("SELECT * FROM held_payments WHERE id = $1", [id])).rows[0];

  async function waitFor(check: () => Promise<boolean>) {
    for (let i = 0; i < 50; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("timed out");
  }

  beforeAll(async () => {
    fake = await installFakePrivy();
    process.env.PRIVY_APP_SECRET = "test-secret";
    process.env.PRIVY_AUTHORIZATION_KEY = "test-key";
    process.env.PRIVY_SIGNER_ID = "test-signer";
    process.env.RESEND_API_KEY = "";
    ({ app } = await import("../src/app"));
    ({ query } = await import("../src/db"));
    held = await import("../src/services/held/heldPayments");
    (await import("../src/services/held/provider")).setHoldingProviderForTests(provider);
    (await import("../src/services/held/chain")).setReleaseChainForTests(chain);
    await query("DELETE FROM rate_limit_hits");
    await makeWallet("pascal");
    await makeWallet("izuu");
    await makeWallet("linked");
    await query("UPDATE wallets SET email = $1 WHERE account_id = $2", [`linked-${run}@example.com`, accounts.linked.id]);
  }, 30_000);

  beforeEach(() => {
    chain.failBuild = false;
    chain.broadcastResult = "confirmed";
    chain.outcomeResult = "confirmed";
  });

  afterAll(async () => {
    const ids = Object.values(accounts).map((a) => a.id);
    await query("DELETE FROM transfers WHERE sender_account_id = ANY($1) OR recipient_account_id = ANY($1)", [ids]);
    await query("DELETE FROM held_payments WHERE sender_account_id = ANY($1)", [ids]);
    await query("DELETE FROM held_wallets WHERE identity_value LIKE $1", [`%-${run}@example.com`]);
    await query("DELETE FROM account_events WHERE account_id = ANY($1)", [ids]);
    await query("DELETE FROM wallets WHERE account_id = ANY($1)", [ids]);
    (await import("../src/services/held/provider")).setHoldingProviderForTests(null);
    (await import("../src/services/held/chain")).setReleaseChainForTests(null);
  });

  // ── quoting ──

  test("an email with a linked Oink wallet is paid directly", async () => {
    const res = await request(app)
      .post("/api/v1/transfer/quote")
      .set("Cookie", accounts.pascal.cookie)
      .send({ recipient: `LINKED-${run}@example.com`, fromSymbolOrMint: "USDC", amountIn: "1" });
    expect(res.status).toBe(200);
    expect(res.body.recipient).toMatchObject({ kind: "account", accountId: accounts.linked.id });
  });

  test("an email nobody has linked becomes a held payment, with no wallet made yet", async () => {
    const before = provider.created.length;
    const res = await request(app)
      .post("/api/v1/transfer/quote")
      .set("Cookie", accounts.pascal.cookie)
      .send({ recipient: izuuEmail, fromSymbolOrMint: "USDC", amountIn: "10" });
    expect(res.status).toBe(200);
    expect(res.body.recipient).toMatchObject({ kind: "held", displayName: izuuEmail });
    expect(res.body.legs).toHaveLength(1);
    expect(provider.created.length).toBe(before); // created at build, not on every re-quote
  });

  test("an X account not on Oink is refused without an X API token", async () => {
    const res = await request(app)
      .post("/api/v1/transfer/quote")
      .set("Cookie", accounts.pascal.cookie)
      .send({ recipient: "x:@nobody_here", fromSymbolOrMint: "USDC", amountIn: "1" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("X_LOOKUP_UNAVAILABLE");
  });

  // ── deposit and claim ──

  test("a deposit is held for 48 hours in one holding wallet per recipient", async () => {
    const a = await deposit(izuuEmail, 10_000_000n);
    const b = await deposit(izuuEmail, 2_500_000n);
    const rowA = await statusOf(a.id);
    const rowB = await statusOf(b.id);
    expect(rowA.status).toBe("held");
    expect(rowA.held_wallet_id).toBe(rowB.held_wallet_id);
    const hours = (new Date(rowA.expires_at).getTime() - new Date(rowA.created_at).getTime()) / 3_600_000;
    expect(Math.round(hours)).toBe(48);
  });

  test("the sender and the recipient-to-be both see it", async () => {
    const sent = await request(app).get("/api/v1/held").set("Cookie", accounts.pascal.cookie).expect(200);
    expect(sent.body.sent.filter((p: any) => p.recipient_display === izuuEmail)).toHaveLength(2);
    const before = await request(app).get("/api/v1/held").set("Cookie", accounts.izuu.cookie).expect(200);
    expect(before.body.incoming).toHaveLength(0); // not linked yet
  });

  test("linking the email claims everything waiting for it, into the claimant's wallet", async () => {
    const token = await fake.mint([fake.email(izuuEmail)]);
    const res = await request(app).post("/api/v1/identity/email").set("Cookie", accounts.izuu.cookie).send({ identityToken: token }).expect(200);
    expect(res.body.claiming).toBe(2);

    await waitFor(async () => {
      const rows = await query("SELECT status FROM held_payments WHERE recipient_value = $1", [izuuEmail]);
      return rows.rows.every((r) => r.status === "claimed");
    });

    const claimantAta = await chain.ensureTokenAccount(accounts.izuu.publicKey, USDC);
    const toIzuu = chain.releases.filter((r) => r.destination === claimantAta);
    expect(toIzuu.map((r) => r.amountBase).sort((a, b) => (a < b ? -1 : 1))).toEqual([2_500_000n, 10_000_000n]);
    // The claimant's account was added to the holding wallet's policy before it was paid.
    expect([...provider.allowed.values()].some((list) => list.includes(claimantAta))).toBe(true);

    const history = await request(app).get("/api/v1/transfer/history").set("Cookie", accounts.izuu.cookie).expect(200);
    const amounts = history.body.transfers.filter((t: any) => t.source === "held").map((t: any) => Number(t.input_amount));
    expect(amounts.sort((a: number, b: number) => a - b)).toEqual([2.5, 10]);
  });

  // ── refunds and exclusivity ──

  test("after 48 hours an unclaimed payment goes back to the sender", async () => {
    const email = `ghost-${run}@example.com`;
    const p = await deposit(email, 7_000_000n);
    await query("UPDATE held_payments SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [p.id]);

    const result = await held.runHeldPaymentsJob();
    expect(result.refunded).toBeGreaterThanOrEqual(1);
    const row = await statusOf(p.id);
    expect(row.status).toBe("refunded");
    expect(row.release_to).toBe(await chain.ensureTokenAccount(accounts.pascal.publicKey, USDC));
  });

  test("an expired payment can no longer be claimed, and an open one cannot be refunded", async () => {
    const late = await deposit(`late-${run}@example.com`, 1_000_000n);
    await query("UPDATE held_payments SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [late.id]);
    expect(await held.releaseHeldPayment(late.id, "claim", accounts.izuu.id)).toBe("skipped");

    const open = await deposit(`open-${run}@example.com`, 1_000_000n);
    expect(await held.releaseHeldPayment(open.id, "refund")).toBe("skipped");
    expect((await statusOf(open.id)).status).toBe("held");
  });

  test("a payment is released once even when claim and refund race", async () => {
    const p = await deposit(`race-${run}@example.com`, 3_000_000n);
    await query("UPDATE wallets SET email = $1 WHERE account_id = $2", [`race-${run}@example.com`, accounts.linked.id]);
    const before = chain.releases.length;
    const results = await Promise.all([
      held.releaseHeldPayment(p.id, "claim", accounts.linked.id),
      held.releaseHeldPayment(p.id, "claim", accounts.linked.id),
      held.releaseHeldPayment(p.id, "claim", accounts.linked.id),
    ]);
    expect(results.filter((r) => r === "released")).toHaveLength(1);
    expect(chain.releases.length - before).toBe(1);
  });

  // ── failures ──

  test("a release that fails before sending is retried, then parked as failed", async () => {
    const p = await deposit(`flaky-${run}@example.com`, 1_000_000n);
    await query("UPDATE held_payments SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [p.id]);
    chain.failBuild = true;
    for (let i = 1; i < held.MAX_RELEASE_ATTEMPTS; i++) {
      expect(await held.releaseHeldPayment(p.id, "refund")).toBe("retry");
      expect((await statusOf(p.id)).status).toBe("held");
    }
    expect(await held.releaseHeldPayment(p.id, "refund")).toBe("failed");
    const row = await statusOf(p.id);
    expect(row.status).toBe("failed");
    expect(row.last_error).toContain("simulated build failure");
  });

  test("a release whose broadcast is unseen is settled by asking the chain, not by resending", async () => {
    const p = await deposit(`unseen-${run}@example.com`, 4_000_000n);
    await query("UPDATE held_payments SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [p.id]);
    chain.broadcastResult = "throw";
    expect(await held.releaseHeldPayment(p.id, "refund")).toBe("in_flight");
    const inFlight = await statusOf(p.id);
    expect(inFlight.status).toBe("refunding");
    expect(inFlight.release_signature).toBeTruthy();

    const releasesBefore = chain.releases.length;
    await query("UPDATE held_payments SET updated_at = NOW() - INTERVAL '10 minutes' WHERE id = $1", [p.id]);
    chain.outcomeResult = "pending";
    await held.reconcileInFlight();
    expect((await statusOf(p.id)).status).toBe("refunding");

    chain.outcomeResult = "confirmed";
    await held.reconcileInFlight();
    expect((await statusOf(p.id)).status).toBe("refunded");
    expect(chain.releases.length).toBe(releasesBefore); // nothing was sent twice
  });

  test("a release that provably never landed goes back to held", async () => {
    const p = await deposit(`dropped-${run}@example.com`, 4_000_000n);
    await query("UPDATE held_payments SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [p.id]);
    chain.broadcastResult = "throw";
    await held.releaseHeldPayment(p.id, "refund");
    await query("UPDATE held_payments SET updated_at = NOW() - INTERVAL '10 minutes' WHERE id = $1", [p.id]);
    chain.outcomeResult = "expired";
    await held.reconcileInFlight();
    const row = await statusOf(p.id);
    expect(row.status).toBe("held");
    expect(row.release_signature).toBeNull();
  });

  // ── admin ──

  test("admins see held payments and can retry a failed one", async () => {
    process.env.ADMIN_EMAILS = `boss-${run}@oink.test`;
    const login = await request(app)
      .post("/api/v1/admin/login")
      .send({ identityToken: await fake.mint([fake.email(`boss-${run}@oink.test`)]) })
      .expect(200);
    const cookie = (login.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

    const list = await request(app).get("/api/v1/admin/held").set("Cookie", cookie).query({ status: "failed" }).expect(200);
    const failed = list.body.held.find((h: any) => h.recipient_display === `flaky-${run}@example.com`);
    expect(failed).toBeDefined();

    await request(app).post(`/api/v1/admin/held/${failed.id}/retry`).set("Cookie", cookie).expect(200);
    expect((await statusOf(failed.id)).status).toBe("held");
    await request(app).post(`/api/v1/admin/held/${failed.id}/retry`).set("Cookie", cookie).expect(409);

    await query("DELETE FROM admin_sessions WHERE email = $1", [`boss-${run}@oink.test`]);
    await query("DELETE FROM admin_audit WHERE admin_email = $1", [`boss-${run}@oink.test`]);
  });
});
