import crypto from "node:crypto";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { getConfig } from "../config";
import { fetchJupiterSwapInstructions } from "./jupiterService";
import { getFeePayerKeypair, getFeePayerPublicKey } from "./feePayer";
import type { StoredQuote } from "./mixEngine";

let connectionInstance: Connection | null = null;

export function getSolanaConnection(): Connection {
  if (!connectionInstance) {
    const config = getConfig();
    connectionInstance = new Connection(config.rpcUrl, "confirmed");
  }
  return connectionInstance;
}

export async function resolveTokenProgramId(mint: PublicKey): Promise<PublicKey> {
  try {
    const connection = getSolanaConnection();
    const info = await connection.getAccountInfo(mint);
    if (info?.owner && info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      return TOKEN_2022_PROGRAM_ID;
    }
  } catch (err) {
    console.warn("Could not query mint program ID, defaulting to standard SPL:", err);
  }
  return TOKEN_PROGRAM_ID;
}

function deserializeInstruction(instruction: any): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((acc: any) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: Buffer.from(instruction.data, "base64"),
  });
}

async function getAddressLookupTableAccounts(
  keys: string[],
): Promise<AddressLookupTableAccount[]> {
  if (!keys || keys.length === 0) return [];
  const connection = getSolanaConnection();

  const accountInfos = await connection.getMultipleAccountsInfo(
    keys.map((k) => new PublicKey(k)),
  );

  return accountInfos.reduce((acc, accountInfo, index) => {
    const key = keys[index];
    if (accountInfo) {
      acc.push(
        new AddressLookupTableAccount({
          key: new PublicKey(key),
          state: AddressLookupTableAccount.deserialize(accountInfo.data),
        }),
      );
    }
    return acc;
  }, new Array<AddressLookupTableAccount>());
}

export interface BuiltTransactionPlan {
  transaction: string; // base64
  feePayer: string;
  partiallySigned: boolean;
  lastValidBlockHeight: number;
  addressLookupTableAddresses: string[];
  messageHash: string;
}

export async function buildSettlementTransaction(params: {
  quote: StoredQuote;
  sponsorFee?: boolean;
}): Promise<BuiltTransactionPlan> {
  const connection = getSolanaConnection();
  const senderPubkey = new PublicKey(params.quote.senderWallet);
  const recipientPubkey = new PublicKey(params.quote.recipient.wallet);

  const feePayerKp = getFeePayerKeypair();
  const shouldSponsor = Boolean(params.sponsorFee && feePayerKp);
  const payerPubkey = shouldSponsor ? feePayerKp!.publicKey : senderPubkey;

  const instructions: TransactionInstruction[] = [];
  const altAddressesSet = new Set<string>();

  for (const leg of params.quote.legs) {
    const legMint = new PublicKey(leg.mint);
    const isSol =
      leg.mint === "11111111111111111111111111111111" ||
      leg.mint === "So11111111111111111111111111111111111111112";

    if (leg.route === "direct") {
      if (isSol && params.quote.inputToken.isNative) {
        // Native SOL transfer
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: senderPubkey,
            toPubkey: recipientPubkey,
            lamports: BigInt(leg.inAmount),
          }),
        );
      } else {
        // SPL Token transfer
        const tokenProgramId = await resolveTokenProgramId(legMint);
        const sourceAta = getAssociatedTokenAddressSync(legMint, senderPubkey, false, tokenProgramId);
        const destAta = getAssociatedTokenAddressSync(legMint, recipientPubkey, true, tokenProgramId);

        // Idempotent ATA creation paid by transaction payer
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            payerPubkey,
            destAta,
            recipientPubkey,
            legMint,
            tokenProgramId,
          ),
        );

        instructions.push(
          createTransferCheckedInstruction(
            sourceAta,
            legMint,
            destAta,
            senderPubkey,
            BigInt(leg.inAmount),
            params.quote.inputToken.decimals,
            [],
            tokenProgramId,
          ),
        );
      }
    } else if (leg.route === "jupiter" && leg.rawJupiterQuote) {
      // Jupiter swap leg
      const tokenProgramId = await resolveTokenProgramId(legMint);
      const recipientAta = getAssociatedTokenAddressSync(legMint, recipientPubkey, true, tokenProgramId);

      // Prepend idempotent ATA creation for recipient so Jupiter routes directly into it
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          payerPubkey,
          recipientAta,
          recipientPubkey,
          legMint,
          tokenProgramId,
        ),
      );

      const swapIxs = await fetchJupiterSwapInstructions({
        quoteResponse: leg.rawJupiterQuote,
        userPublicKey: senderPubkey.toBase58(),
        destinationTokenAccount: recipientAta.toBase58(),
        wrapAndUnwrapSol: true,
      });

      if (swapIxs.computeBudgetInstructions) {
        for (const ix of swapIxs.computeBudgetInstructions) {
          instructions.push(deserializeInstruction(ix));
        }
      }
      if (swapIxs.setupInstructions) {
        for (const ix of swapIxs.setupInstructions) {
          instructions.push(deserializeInstruction(ix));
        }
      }
      if (swapIxs.swapInstruction) {
        instructions.push(deserializeInstruction(swapIxs.swapInstruction));
      }
      if (swapIxs.cleanupInstruction) {
        instructions.push(deserializeInstruction(swapIxs.cleanupInstruction));
      }
      if (swapIxs.addressLookupTableAddresses) {
        for (const addr of swapIxs.addressLookupTableAddresses) {
          altAddressesSet.add(addr);
        }
      }
    }
  }

  const altAccounts = await getAddressLookupTableAccounts(Array.from(altAddressesSet));
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  const messageV0 = new TransactionMessage({
    payerKey: payerPubkey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(altAccounts);

  const transaction = new VersionedTransaction(messageV0);

  // If sponsored, fee payer partially signs
  let partiallySigned = false;
  if (shouldSponsor && feePayerKp) {
    transaction.sign([feePayerKp]);
    partiallySigned = true;
  }

  const serialized = Buffer.from(transaction.serialize()).toString("base64");
  const messageBytes = transaction.message.serialize();
  const messageHash = crypto.createHash("sha256").update(messageBytes).digest("hex");

  return {
    transaction: serialized,
    feePayer: payerPubkey.toBase58(),
    partiallySigned,
    lastValidBlockHeight,
    addressLookupTableAddresses: Array.from(altAddressesSet),
    messageHash,
  };
}
