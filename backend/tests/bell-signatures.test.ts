import { expect, test } from "bun:test";
import { Keypair, TransactionMessage, VersionedTransaction, SystemProgram } from "@solana/web3.js";
import { bellMessageHash } from "../src/services/bell/transaction";
import { verifySignedBellTransaction } from "../src/services/bell/signatures";
function plan() {
  const key = Keypair.generate();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: key.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: key.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message(),
  );
  return { key, tx };
}
test("only an intact locally signed plan passes", () => {
  const { key, tx } = plan(),
    hash = bellMessageHash(tx);
  tx.sign([key]);
  expect(
    verifySignedBellTransaction(
      Buffer.from(tx.serialize()).toString("base64"),
      hash,
      key.publicKey.toBase58(),
    ).signature.length,
  ).toBeGreaterThan(80);
});
test("rejects unsigned, changed-message, wrong-wallet and forged-signature submissions", () => {
  const { key, tx } = plan(),
    hash = bellMessageHash(tx),
    wallet = key.publicKey.toBase58();
  expect(() =>
    verifySignedBellTransaction(Buffer.from(tx.serialize()).toString("base64"), hash, wallet),
  ).toThrow();
  tx.sign([key]);
  const encoded = Buffer.from(tx.serialize()).toString("base64");
  expect(() => verifySignedBellTransaction(encoded, "different", wallet)).toThrow();
  expect(() =>
    verifySignedBellTransaction(encoded, hash, Keypair.generate().publicKey.toBase58()),
  ).toThrow();
  tx.signatures[0][0] ^= 1;
  expect(() =>
    verifySignedBellTransaction(Buffer.from(tx.serialize()).toString("base64"), hash, wallet),
  ).toThrow();
});
