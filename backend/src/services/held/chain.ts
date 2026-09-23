import bs58 from "bs58";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { getFeePayerKeypair } from "../feePayer";
import { getSolanaConnection, resolveTokenProgramId } from "../txBuilder";

/**
 * The on-chain steps of a release, behind an interface so the claim/refund lifecycle can be
 * tested without a validator. The release transaction holds exactly one instruction — the
 * TransferChecked the holding wallet's policy allows — so creating the destination's token
 * account happens first, in a separate transaction only the fee payer signs.
 */
export interface ReleaseChain {
  /** The destination token account, created (fee payer pays rent) if it does not exist. */
  ensureTokenAccount(owner: string, mint: string): Promise<string>;
  buildRelease(input: {
    holdingWallet: string;
    mint: string;
    decimals: number;
    amountBase: bigint;
    destination: string;
    sign: (unsignedBase64: string) => Promise<string>;
  }): Promise<{ signature: string; lastValidBlockHeight: number; raw: Uint8Array }>;
  broadcast(raw: Uint8Array, lastValidBlockHeight: number): Promise<"confirmed" | "failed">;
  /** For a release whose fate was not seen: landed, failed, still in flight, or can never land. */
  outcome(signature: string, lastValidBlockHeight: number): Promise<"confirmed" | "failed" | "pending" | "expired">;
}

function feePayer() {
  const kp = getFeePayerKeypair();
  if (!kp) throw new Error("Fee payer not configured");
  return kp;
}

async function compile(instructions: TransactionInstruction[]) {
  const connection = getSolanaConnection();
  const payer = feePayer();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message();
  return { tx: new VersionedTransaction(message), lastValidBlockHeight };
}

const solanaReleaseChain: ReleaseChain = {
  async ensureTokenAccount(owner, mint) {
    const mintKey = new PublicKey(mint);
    const ownerKey = new PublicKey(owner);
    const program = await resolveTokenProgramId(mintKey);
    const ata = getAssociatedTokenAddressSync(mintKey, ownerKey, true, program);
    const connection = getSolanaConnection();
    if (await connection.getAccountInfo(ata, "confirmed")) return ata.toBase58();

    const payer = feePayer();
    const { tx, lastValidBlockHeight } = await compile([
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, ownerKey, mintKey, program),
    ]);
    tx.sign([payer]);
    const signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    const result = await connection.confirmTransaction(
      { signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (result.value.err) throw new Error(`Creating the destination token account failed: ${JSON.stringify(result.value.err)}`);
    return ata.toBase58();
  },

  async buildRelease({ holdingWallet, mint, decimals, amountBase, destination, sign }) {
    const mintKey = new PublicKey(mint);
    const owner = new PublicKey(holdingWallet);
    const program = await resolveTokenProgramId(mintKey);
    const source = getAssociatedTokenAddressSync(mintKey, owner, true, program);
    const { tx, lastValidBlockHeight } = await compile([
      createTransferCheckedInstruction(source, mintKey, new PublicKey(destination), owner, amountBase, decimals, [], program),
    ]);

    // The holding wallet signs through Privy, whose enclave checks the policy; the fee payer
    // adds its signature after, so Privy never sees a transaction it could not refuse.
    const signed = VersionedTransaction.deserialize(
      Buffer.from(await sign(Buffer.from(tx.serialize()).toString("base64")), "base64"),
    );
    if (Buffer.compare(Buffer.from(signed.message.serialize()), Buffer.from(tx.message.serialize())) !== 0) {
      throw new Error("Privy returned a different transaction than it was asked to sign");
    }
    signed.sign([feePayer()]);
    // The fee payer signs first, so its signature is the transaction's ID.
    return { signature: bs58.encode(signed.signatures[0]), lastValidBlockHeight, raw: signed.serialize() };
  },

  async broadcast(raw, lastValidBlockHeight) {
    const connection = getSolanaConnection();
    const tx = VersionedTransaction.deserialize(raw);
    const signature = await connection.sendRawTransaction(raw, { maxRetries: 3 });
    const result = await connection.confirmTransaction(
      { signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight },
      "confirmed",
    );
    return result.value.err ? "failed" : "confirmed";
  },

  async outcome(signature, lastValidBlockHeight) {
    const connection = getSolanaConnection();
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status) {
      if (status.err) return "failed";
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return "confirmed";
      return "pending";
    }
    const height = await connection.getBlockHeight("confirmed");
    return height > lastValidBlockHeight ? "expired" : "pending";
  },
};

let chain: ReleaseChain = solanaReleaseChain;

export function getReleaseChain(): ReleaseChain {
  return chain;
}

export function setReleaseChainForTests(fake: ReleaseChain | null) {
  chain = fake ?? solanaReleaseChain;
}
