import {
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { getConfig } from "../config";
import { FlowError } from "./flow/settings";
import { getSolanaConnection, resolveTokenProgramId } from "./txBuilder";

/**
 * Unsigned transfers for a wallet Oink does not control — a Seeker/Android wallet over Mobile
 * Wallet Adapter. The external wallet is the only signer and fee payer; no Oink key appears in
 * the transaction, so building it confers no spending authority. Shaped like a Solana Pay
 * transfer: an optional reference is attached as a read-only, non-signer key on the token
 * transfer, which is exactly what the existing income verification looks for.
 */
export interface ExternalPayment {
  payer: string;
  recipient: string;
  mint: string;
  tokenBase: bigint;
  lamports: bigint;
  reference?: string;
}

const MAX_TOKEN_BASE = 10n ** 15n; // 1e9 USDC: a sanity bound, not a product limit
const MAX_LAMPORTS = 10n ** 12n; // 1,000 SOL

export function walletChain(): string {
  const network = getConfig().network;
  return network === "mainnet-beta" ? "solana:mainnet" : `solana:${network}`;
}

export function parsePublicKey(value: unknown, label: string): PublicKey {
  try {
    if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) throw 0;
    return new PublicKey(value);
  } catch {
    throw new FlowError("VALIDATION_FAILED", `${label} must be a Solana address.`);
  }
}

export async function buildExternalPayment(
  payment: ExternalPayment,
): Promise<{ transaction: string; chain: string }> {
  const payer = parsePublicKey(payment.payer, "The paying wallet");
  const recipient = parsePublicKey(payment.recipient, "The recipient");
  if (payer.equals(recipient))
    throw new FlowError("VALIDATION_FAILED", "Choose a different wallet to pay from.");
  if (
    payment.tokenBase < 0n ||
    payment.lamports < 0n ||
    payment.tokenBase > MAX_TOKEN_BASE ||
    payment.lamports > MAX_LAMPORTS ||
    payment.tokenBase + payment.lamports === 0n
  )
    throw new FlowError("VALIDATION_FAILED", "Enter a positive amount.");
  const connection = getSolanaConnection();
  const instructions: TransactionInstruction[] = [];
  if (payment.lamports > 0n)
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: recipient,
        lamports: payment.lamports,
      }),
    );
  if (payment.tokenBase > 0n) {
    const mint = new PublicKey(payment.mint);
    const program = await resolveTokenProgramId(mint);
    const { decimals } = await getMint(connection, mint, "confirmed", program);
    const source = getAssociatedTokenAddressSync(mint, payer, true, program);
    const destination = getAssociatedTokenAddressSync(mint, recipient, true, program);
    const balance = await connection
      .getTokenAccountBalance(source, "confirmed")
      .then((result) => BigInt(result.value.amount))
      .catch(() => 0n);
    if (balance < payment.tokenBase)
      throw new FlowError(
        "INSUFFICIENT_FUNDS",
        "The paying wallet does not hold enough USDC.",
        409,
      );
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        destination,
        recipient,
        mint,
        program,
      ),
    );
    const transfer = createTransferCheckedInstruction(
      source,
      mint,
      destination,
      payer,
      payment.tokenBase,
      decimals,
      [],
      program,
    );
    if (payment.reference)
      transfer.keys.push({
        pubkey: parsePublicKey(payment.reference, "The payment reference"),
        isSigner: false,
        isWritable: false,
      });
    instructions.push(transfer);
  }
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(
    ...instructions,
  );
  // Invariant: the external wallet is the only signer. Anything else would be a custody bug.
  const signers = transaction
    .compileMessage()
    .accountKeys.filter((_, index) => transaction.compileMessage().isAccountSigner(index));
  if (signers.length !== 1 || !signers[0].equals(payer))
    throw new FlowError("INVALID_TRANSACTION", "Could not build a safe payment.", 500);
  return {
    transaction: transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    chain: walletChain(),
  };
}
