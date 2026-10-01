import { VersionedTransaction, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { bellMessageHash } from "./transaction";
import { FlowError } from "../flow/settings";
export function verifySignedBellTransaction(
  value: unknown,
  messageHash: string,
  wallet: string,
): { bytes: Uint8Array; signature: string } {
  try {
    if (typeof value !== "string" || value.length > 2000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
      throw new Error("Invalid encoding.");
    const bytes = Buffer.from(value, "base64"),
      tx = VersionedTransaction.deserialize(bytes),
      owner = new PublicKey(wallet);
    if (
      bytes.length > 1232 ||
      bellMessageHash(tx) !== messageHash ||
      tx.message.header.numRequiredSignatures !== 1 ||
      !tx.message.staticAccountKeys[0].equals(owner) ||
      tx.signatures.length !== 1 ||
      !nacl.sign.detached.verify(tx.message.serialize(), tx.signatures[0], owner.toBytes())
    )
      throw new Error("Invalid signature or message.");
    return { bytes, signature: bs58.encode(tx.signatures[0]) };
  } catch {
    throw new FlowError(
      "INVALID_TRANSACTION",
      "The signed transaction does not match this wallet's approved execution plan.",
      400,
    );
  }
}
