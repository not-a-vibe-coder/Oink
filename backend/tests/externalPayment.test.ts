import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  MINT_SIZE,
  MintLayout,
  TOKEN_PROGRAM_ID,
  decodeTransferCheckedInstruction,
} from "@solana/spl-token";
import { buildExternalPayment } from "../src/services/externalPayment";
import { getSolanaConnection } from "../src/services/txBuilder";

const payer = Keypair.generate().publicKey.toBase58();
const recipient = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey.toBase58();
const reference = Keypair.generate().publicKey.toBase58();
let balance = 10_000_000n;
let restores: (() => void)[] = [];

function classicMint(): Buffer {
  const data = Buffer.alloc(MINT_SIZE);
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
    data,
  );
  return data;
}

beforeEach(() => {
  const connection = getSolanaConnection();
  restores = [
    spyOn(connection, "getAccountInfo").mockResolvedValue({
      data: classicMint(),
      owner: TOKEN_PROGRAM_ID,
      lamports: 1,
      executable: false,
      rentEpoch: 0,
    }),
    spyOn(connection, "getTokenAccountBalance").mockImplementation(async () => ({
      context: { slot: 1 },
      value: { amount: balance.toString(), decimals: 6, uiAmount: null },
    })),
    spyOn(connection, "getLatestBlockhash").mockResolvedValue({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 100,
    }),
  ].map((spy) => () => spy.mockRestore());
});
afterEach(() => restores.forEach((restore) => restore()));

describe("external wallet payments", () => {
  test("referenced USDC transfer: payer is the only signer and the reference is read-only", async () => {
    const built = await buildExternalPayment({
      payer,
      recipient,
      mint,
      tokenBase: 5_000_000n,
      lamports: 0n,
      reference,
    });
    expect(built.chain).toBe("solana:devnet");
    const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
    const message = tx.compileMessage();
    const signers = message.accountKeys.filter((_, i) => message.isAccountSigner(i));
    expect(signers.map(String)).toEqual([payer]);
    expect(tx.feePayer?.toBase58()).toBe(payer);
    const index = message.accountKeys.findIndex((key) => key.toBase58() === reference);
    expect(index).toBeGreaterThan(-1);
    expect(message.isAccountSigner(index)).toBe(false);
    expect(message.isAccountWritable(index)).toBe(false);
    const transfer = tx.instructions.find(
      (ix) => ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === 12,
    )!;
    const decoded = decodeTransferCheckedInstruction(
      { ...transfer, keys: transfer.keys.slice(0, 4) },
      TOKEN_PROGRAM_ID,
    );
    expect(decoded.data.amount).toBe(5_000_000n);
    expect(decoded.data.decimals).toBe(6);
    expect(decoded.keys.owner.pubkey.toBase58()).toBe(payer);
  });
  test("top-up can carry SOL and USDC together", async () => {
    const built = await buildExternalPayment({
      payer,
      recipient,
      mint,
      tokenBase: 1_000_000n,
      lamports: 20_000_000n,
    });
    const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
    const sol = tx.instructions.find((ix) => ix.programId.equals(SystemProgram.programId))!;
    expect(sol.data.readBigUInt64LE(4)).toBe(20_000_000n);
  });
  test("rejects self-payment, empty or oversized amounts, bad keys and missing funds", async () => {
    const base = { payer, recipient, mint, tokenBase: 1n, lamports: 0n };
    await expect(buildExternalPayment({ ...base, recipient: payer })).rejects.toThrow();
    await expect(buildExternalPayment({ ...base, tokenBase: 0n })).rejects.toThrow();
    await expect(buildExternalPayment({ ...base, tokenBase: -1n })).rejects.toThrow();
    await expect(buildExternalPayment({ ...base, lamports: 10n ** 13n })).rejects.toThrow();
    await expect(buildExternalPayment({ ...base, payer: "not-a-key" })).rejects.toThrow();
    balance = 0n;
    await expect(buildExternalPayment(base)).rejects.toThrow("enough USDC");
    balance = 10_000_000n;
  });
});
