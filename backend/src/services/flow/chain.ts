import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { getConfig } from "../../config";
import { USDC } from "../../lib/tokens";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getSolanaConnection } from "../txBuilder";
import { FlowError } from "./settings";

export function flowUsdcMint(): string {
  const network = getConfig().network;
  if (network === "mainnet-beta") return USDC.mint;
  const configured = process.env.FLOW_USDC_MINT;
  if (!configured) throw new FlowError("NOT_CONFIGURED", "Set the USDC mint for this network before receiving income.", 503);
  return new PublicKey(configured).toBase58();
}
export interface ExpectedIncome { recipient_wallet: string; reference: string; token_mint: string; amount_base: string; created_at: Date | string }
export function verifyIncomeEvidence(tx: ParsedTransactionWithMeta | null, expected: ExpectedIncome): number {
  if (!tx?.meta || tx.meta.err) throw new FlowError("PAYMENT_UNVERIFIED", "A successful finalized payment is required.", 409);
  if (!tx.blockTime || tx.blockTime * 1000 < new Date(expected.created_at).getTime() - 60_000) throw new FlowError("PAYMENT_UNVERIFIED", "This transaction predates the payment request.", 409);
  const reference = tx.transaction.message.accountKeys.find((entry) => entry.pubkey.toBase58() === expected.reference);
  if (!reference || reference.signer || reference.writable) throw new FlowError("PAYMENT_UNVERIFIED", "The payment reference is missing or invalid.", 409);
  const ownerBalances = (balances: NonNullable<ParsedTransactionWithMeta["meta"]>["postTokenBalances"]) => {
    if (!balances) throw new FlowError("PAYMENT_UNVERIFIED", "Token balance evidence is missing.", 409);
    return balances.filter((balance) => balance.mint === expected.token_mint && balance.owner === expected.recipient_wallet).reduce((sum, balance) => {
      if (balance.uiTokenAmount.decimals !== 6 || !/^\d+$/.test(balance.uiTokenAmount.amount)) throw new FlowError("PAYMENT_UNVERIFIED", "Invalid USDC balance evidence.", 409);
      return sum + BigInt(balance.uiTokenAmount.amount);
    }, 0n);
  };
  const received = ownerBalances(tx.meta.postTokenBalances) - ownerBalances(tx.meta.preTokenBalances);
  if (received !== BigInt(expected.amount_base)) throw new FlowError("PAYMENT_UNVERIFIED", "The recipient did not receive the exact requested USDC amount.", 409);
  return tx.slot;
}
export async function verifyIncome(signature: string, expected: ExpectedIncome): Promise<number> {
  const tx = await getSolanaConnection().getParsedTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  return verifyIncomeEvidence(tx, expected);
}
export async function freshUsdcBalance(wallet: string, mint: string, minContextSlot?: number): Promise<bigint> {
  const response = await getSolanaConnection().getParsedTokenAccountsByOwner(new PublicKey(wallet), { programId: TOKEN_PROGRAM_ID }, { commitment: "finalized", ...(minContextSlot !== undefined ? { minContextSlot } : {}) });
  return response.value.reduce((sum, { account }) => {
    const info = account.data.parsed?.info;
    if (info?.mint !== mint) return sum;
    if (info.owner !== wallet || info.tokenAmount?.decimals !== 6 || !/^\d+$/.test(info.tokenAmount?.amount ?? "")) throw new FlowError("BALANCE_UNAVAILABLE", "Could not verify the available USDC balance.", 503);
    return sum + BigInt(info.tokenAmount.amount);
  }, 0n);
}
