import { expect, test } from "bun:test";
import { Keypair, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { verifyIncomeEvidence } from "../src/services/flow/chain";
const recipient = Keypair.generate().publicKey.toBase58();
const reference = Keypair.generate().publicKey;
const expected = {
  recipient_wallet: recipient,
  reference: reference.toBase58(),
  token_mint: "mint",
  amount_base: "500",
  created_at: new Date(100000),
};
function evidence(amount = "500"): ParsedTransactionWithMeta {
  return {
    slot: 42,
    blockTime: 110,
    transaction: {
      signatures: [],
      message: {
        accountKeys: [{ pubkey: reference, signer: false, writable: false }],
        instructions: [],
        recentBlockhash: "",
      },
    },
    meta: {
      err: null,
      fee: 0,
      preBalances: [],
      postBalances: [],
      preTokenBalances: [],
      postTokenBalances: [
        {
          accountIndex: 0,
          mint: "mint",
          owner: recipient,
          uiTokenAmount: { amount, decimals: 6, uiAmount: null },
        },
      ],
    },
  };
}
test("accepts exact recipient net credit with unique reference", () => {
  expect(verifyIncomeEvidence(evidence(), expected)).toBe(42);
});
test("rejects missing, failed, wrong-amount, wrong-owner and writable-reference evidence", () => {
  expect(() => verifyIncomeEvidence(null, expected)).toThrow();
  expect(() => verifyIncomeEvidence(evidence("499"), expected)).toThrow();
  const failed = evidence();
  failed.meta!.err = "failed";
  expect(() => verifyIncomeEvidence(failed, expected)).toThrow();
  const wrongOwner = evidence();
  wrongOwner.meta!.postTokenBalances![0].owner = "other";
  expect(() => verifyIncomeEvidence(wrongOwner, expected)).toThrow();
  const writable = evidence();
  writable.transaction.message.accountKeys[0].writable = true;
  expect(() => verifyIncomeEvidence(writable, expected)).toThrow();
});
