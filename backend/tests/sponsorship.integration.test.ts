import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { query } from "../src/db";
import { migrate } from "../src/db/migrate";
import { SKR } from "../src/lib/tokens";
import { checkSponsorshipBudget, clearSkrCache, skrBalance } from "../src/services/feePayer";
import { getSolanaConnection } from "../src/services/txBuilder";

const url = process.env.TEST_DATABASE_URL;
const suite = url && url === process.env.DATABASE_URL ? describe : describe.skip;
const holder = "oink-skr0-0001",
  regular = "oink-skr0-0002";
const holderWallet = Keypair.generate().publicKey.toBase58();
const regularWallet = Keypair.generate().publicKey.toBase58();
let balances: Record<string, { mint: string; owner: string; amount: string; decimals: number }[]> =
  {};
let rpcDown = false;

suite("SKR holder sponsorship quota (PostgreSQL, mocked RPC)", () => {
  let restore = () => {};
  beforeAll(async () => {
    await migrate();
    for (const [id, key] of [
      [holder, holderWallet],
      [regular, regularWallet],
    ])
      await query(
        "INSERT INTO wallets (account_id,public_key,ciphertext,nonce,kdf_salt,kdf_params,auth_key_hash,totp_secret_enc,totp_nonce) VALUES ($1,$2,'test','test','test','{}','test','test','test')",
        [id, key],
      );
    process.env.FEE_PAYER_SECRET_KEY ??= JSON.stringify(Array.from(Keypair.generate().secretKey));
    process.env.FEE_SPONSOR_ENABLED = "true";
    const spy = spyOn(getSolanaConnection(), "getParsedTokenAccountsByOwner").mockImplementation(
      async (owner, filter) => {
        if (rpcDown) throw new Error("rpc down");
        expect("mint" in filter && filter.mint.toBase58()).toBe(SKR.mint);
        return {
          context: { slot: 1 },
          value: (balances[owner.toBase58()] ?? []).map((entry) => ({
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
                    mint: entry.mint,
                    owner: entry.owner,
                    tokenAmount: { amount: entry.amount, decimals: entry.decimals },
                  },
                },
              },
            },
          })),
        };
      },
    );
    restore = () => spy.mockRestore();
  });
  afterEach(() => {
    clearSkrCache();
    rpcDown = false;
  });
  afterAll(async () => {
    restore();
    await query("DELETE FROM fee_sponsorships WHERE account_id = ANY($1)", [[holder, regular]]);
    await query("DELETE FROM wallets WHERE account_id = ANY($1)", [[holder, regular]]);
  });

  const skr = (owner: string, amount: string, decimals = 6) => ({
    mint: SKR.mint,
    owner,
    amount,
    decimals,
  });

  test("balance is read on-chain for the official mint and fails closed", async () => {
    balances = { [holderWallet]: [skr(holderWallet, "600000000"), skr(holderWallet, "400000000")] };
    expect(await skrBalance(holderWallet)).toBe(1_000_000_000n);
    clearSkrCache();
    balances = { [holderWallet]: [skr(holderWallet, "1000000000", 9)] }; // wrong decimals
    expect(await skrBalance(holderWallet)).toBe(0n);
    clearSkrCache();
    balances = { [holderWallet]: [skr(regularWallet, "1000000000")] }; // someone else's account
    expect(await skrBalance(holderWallet)).toBe(0n);
    clearSkrCache();
    rpcDown = true;
    expect(await skrBalance(holderWallet)).toBe(0n);
  });

  test("holders at the threshold get the higher quota; others keep the standard one", async () => {
    balances = {
      [holderWallet]: [skr(holderWallet, "1000000000")], // exactly 1,000 SKR
      [regularWallet]: [skr(regularWallet, "999999999")], // one base unit short
    };
    const h = await checkSponsorshipBudget(holder);
    const r = await checkSponsorshipBudget(regular);
    expect(h).toMatchObject({ eligible: true, tier: "skr", remainingToday: 60 });
    expect(r).toMatchObject({ eligible: true, tier: "standard", remainingToday: 20 });
  });

  test("the higher quota is still a limit, and the global budget is shared", async () => {
    balances = { [holderWallet]: [skr(holderWallet, "5000000000")] };
    for (let i = 0; i < 60; i++)
      await query(
        "INSERT INTO fee_sponsorships (account_id, signature, lamports, day, created_at) VALUES ($1,$2,5000,CURRENT_DATE,NOW())",
        [holder, `skr_test_${i}_${Date.now()}`],
      );
    expect(await checkSponsorshipBudget(holder)).toMatchObject({
      eligible: false,
      tier: "skr",
    });
    process.env.FEE_SPONSOR_GLOBAL_LAMPORTS_PER_DAY = "1";
    expect((await checkSponsorshipBudget(regular)).eligible).toBe(false);
    delete process.env.FEE_SPONSOR_GLOBAL_LAMPORTS_PER_DAY;
  });

  test("an RPC outage downgrades a holder to the standard quota, never above it", async () => {
    await query("DELETE FROM fee_sponsorships WHERE account_id = $1", [holder]);
    balances = { [holderWallet]: [skr(holderWallet, "5000000000")] };
    rpcDown = true;
    expect(await checkSponsorshipBudget(holder)).toMatchObject({
      tier: "standard",
      remainingToday: 20,
    });
  });
});
