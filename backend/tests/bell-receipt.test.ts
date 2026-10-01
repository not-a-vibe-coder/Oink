import { expect, test } from "bun:test";
import { Keypair, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { bellFillReceipt } from "../src/services/bell/reconcile";
import type { BellQuote } from "../../src/lib/bell/types";
import { DEFAULT_BELL_POLICY } from "../../src/lib/bell/policy";
const owner = Keypair.generate().publicKey;
const quote = {
  inputMint: Keypair.generate().publicKey.toBase58(),
  outputMint: Keypair.generate().publicKey.toBase58(),
  inAmount: "10000000",
  minimumOutput: "99500",
  outputDecimals: 6,
  policy: DEFAULT_BELL_POLICY,
} as BellQuote;
function fixture(output = "100000"): ParsedTransactionWithMeta {
  const balance = (mint: string, amount: string, accountIndex: number) => ({
    mint,
    owner: owner.toBase58(),
    accountIndex,
    uiTokenAmount: { amount, decimals: 6, uiAmount: null, uiAmountString: "0" },
  });
  return {
    slot: 123,
    blockTime: null,
    transaction: {
      signatures: ["fixture"],
      message: {
        accountKeys: [{ pubkey: owner, signer: true, writable: true }],
        recentBlockhash: owner.toBase58(),
        instructions: [],
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [100000000],
      postBalances: [99995000],
      preTokenBalances: [
        balance(quote.inputMint, "10000000", 1),
        balance(quote.outputMint, "0", 2),
      ],
      postTokenBalances: [balance(quote.inputMint, "0", 1), balance(quote.outputMint, output, 2)],
    },
  };
}
test("finalized receipt records exact fill and fees; flags execution mismatch", () => {
  const receipt = bellFillReceipt(fixture(), quote, owner.toBase58());
  expect(receipt).toEqual({
    inputBase: "10000000",
    outputBase: "100000",
    networkFeeLamports: "5000",
    solChangeLamports: "-5000",
    withinLimits: true,
    slot: 123,
  });
  expect(bellFillReceipt(fixture("1"), quote, owner.toBase58()).withinLimits).toBe(false);
  expect(
    bellFillReceipt(
      fixture(),
      { ...quote, policy: { ...DEFAULT_BELL_POLICY, maxTokenPriceBase: "1" } },
      owner.toBase58(),
    ).withinLimits,
  ).toBe(false);
});
test("incomplete token ownership or failed transactions cannot prove a successful fill", () => {
  const incomplete = fixture();
  delete incomplete.meta!.postTokenBalances![0].owner;
  expect(() => bellFillReceipt(incomplete, quote, owner.toBase58())).toThrow();
  const failed = fixture();
  failed.meta!.err = { InstructionError: [0, "InvalidArgument"] };
  expect(() => bellFillReceipt(failed, quote, owner.toBase58())).toThrow();
});
